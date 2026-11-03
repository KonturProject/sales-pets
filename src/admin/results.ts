import { THEME } from '@/art/manifest';
import { serverToday, type Snapshot, type SnapshotCorrection } from '@/data/api';
import { timelineOf } from '@/data/config';
import { buildFacts, effectiveFacts } from '@/data/facts';
import { addDays, isWorkingDay, nextWorkingDay, prevWorkingDay, workingDaysBetween } from '@/engine/calendar';
import type { Config } from '@/engine/config';
import { evaluateDay, groupPlan, paymentPlanCents, type DayResult } from '@/engine/evaluate';
import { ruNum } from '@/engine/format';
import type { PetState } from '@/engine/pet';
import { groupOn, isPresent, levelOn, type Absence, type Employee } from '@/engine/staff';
import { GROUPS, type DateStr, type GroupCode, type Level } from '@/engine/types';
import { groupFunnel } from '@/game/tv/metrics';

export type Kind = 'quality' | 'long' | 'payments';
const KINDS: Kind[] = ['quality', 'long', 'payments'];
const KIND_TITLE: Record<Kind, string> = { quality: 'Качественные', long: 'Длинные', payments: 'Оплаты' };
/** Предел одной правки на сервере: |дельта| ≤ 50. */
const MAX_DELTA = 50;

/**
 * Ячейка «факт / план». `plan` null — плана нет (выходной, день без воронки). `corrected` — сумма ручных правок, вошедших в `fact`;
 * `stale` — среди них есть устаревшая. `weekend` у оплат рабочего дня — сколько из факта пришло в выходные перед ним.
 */
export interface Cell { fact: number; plan: number | null; corrected: number; stale: boolean; weekend?: number }

export type Outcome =
  | { evaluated: true; result: DayResult; medkit: boolean; pile: boolean; pileRemoved: boolean; toy: boolean; appliesOn: DateStr | null }
  | { evaluated: false; reason: 'weekend' | 'no-funnel' };

/**
 * `day` и `total` — ячейки таблицы. Для редактора правки — значения выбранного календарного дня (не «корзина» оплат из
 * `day.payments`): `file` из файла, `corrections` — сумма правок этого дня без отсечения (может быть < 0), `current` — что
 * видно в игре: max(0, file + corrections).
 */
export interface EmployeeLine {
  id: string; name: string; level: Level; absence: Absence['kind'] | null; inGroupTotal: boolean; hidden: boolean;
  day: Record<Kind, Cell>; total: Record<Kind, Cell>;
  file: Record<Kind, number>; corrections: Record<Kind, number>; current: Record<Kind, number>;
}

export interface GroupLine {
  group: GroupCode; hero: string; day: Record<Kind, Cell>; total: Record<Kind, Cell>; gamePlanPercent: number | null;
  outcome: Outcome; now: PetState; nowReason: string | null; employees: EmployeeLine[];
  /** оплаты группы, не разнесённые по сотрудникам (может быть < 0), и из них авторов не из штата */
  unassigned: { payments: number; unmatched: number };
}

const dateRange = (from: DateStr, to: DateStr): DateStr[] => {
  const out: DateStr[] = [];
  for (let x = from; x <= to; x = addDays(x, 1)) out.push(x);
  return out;
};
const cents = (n: number) => Math.round(n * 100);
const byKey = (id: string, date: DateStr) => `${id}|${date}`;

/** Дни игры с 02.11 по вчера сервера. Календарь берётся из базы настроек: записи «с даты» его не меняют. */
export function resultsDays(s: Snapshot): { date: DateStr; working: boolean }[] {
  const today = serverToday(s);
  const cfg = timelineOf(s).at(today);
  const yesterday = addDays(today, -1);
  return dateRange(cfg.startDate, yesterday < cfg.endDate ? yesterday : cfg.endDate).map((date) => ({ date, working: isWorkingDay(date, cfg) }));
}

/** Последний оценённый день: самый поздний рабочий не позже funnelThrough и вчерашнего; без воронки — вчерашний день игры; null — дней игры ещё нет. */
export function defaultResultsDay(s: Snapshot): DateStr | null {
  const days = resultsDays(s);
  const through = s.funnelThrough;
  if (through !== null) {
    for (let i = days.length - 1; i >= 0; i--) if (days[i].working && days[i].date <= through) return days[i].date;
  }
  return days.at(-1)?.date ?? null;
}

export interface CorrectionView {
  c: SnapshotCorrection;
  /** группа сотрудника на дату правки; null — сотрудника больше нет в штате (правка не действует, но её можно отменить) */
  group: GroupCode | null;
  name: string;
  /** значение «из файла» сейчас; null — файл за этот день ещё не загружен */
  fileNow: number | null;
  /** значение «из файла» теперь не то, что админ видел при правке (`base`) */
  stale: boolean;
}

/** Все правки, новые сверху, с группой на дату и признаком «устарела». */
export function correctionViews(s: Snapshot): CorrectionView[] {
  const eff = effectiveFacts(s);
  const staff = new Map(s.staff.map((e) => [e.id, e]));
  return [...(s.corrections ?? [])].sort((a, b) => b.id - a.id).map((c) => {
    const e = staff.get(c.employeeId);
    const loadedThrough = c.kind === 'payments' ? s.paymentsImportedThrough : s.funnelThrough;
    const key = byKey(c.employeeId, c.date);
    let fileNow: number | null = null;
    if (loadedThrough !== null && c.date <= loadedThrough) {
      fileNow = c.kind === 'payments' ? eff.fileInvoices.get(key) ?? 0 : eff.fileFunnel.get(key)?.[c.kind] ?? 0;
    }
    return { c, group: e ? groupOn(e, c.date) : null, name: e ? e.name : 'нет в штате', fileNow, stale: fileNow !== null && fileNow !== c.base };
  });
}

/** Сумма правок и признак «есть устаревшая» по тем, что прошли отбор; правки ушедших из штата в фактах не участвуют. */
function corrections(views: CorrectionView[], pick: (v: CorrectionView) => boolean): { corrected: number; stale: boolean } {
  let corrected = 0;
  let stale = false;
  for (const v of views) {
    if (v.group === null || !pick(v)) continue;
    corrected += v.c.delta;
    stale ||= v.stale;
  }
  return { corrected, stale };
}

/** «Корзина» оплат рабочего дня, как у движка: после предыдущего рабочего дня по `day` включительно (с начала игры для первого). Выходной — только он сам. */
function basket(day: DateStr, cfg: Config): DateStr[] {
  if (!isWorkingDay(day, cfg)) return [day];
  const prev = prevWorkingDay(day, cfg);
  return dateRange(prev ? addDays(prev, 1) : cfg.startDate, day);
}

const sumDays = (byDay: Record<DateStr, number>, days: DateStr[]) => days.reduce((a, x) => a + (byDay[x] ?? 0), 0);

/** Отсутствие, действующее в день `d` (то же условие, что в `isPresent`). */
const absenceOn = (absences: Absence[], id: string, d: DateStr): Absence['kind'] | null =>
  absences.find((a) => a.employeeId === id && a.from <= d && (a.to === null || d <= a.to))?.kind ?? null;

/** Итоги дня по группам и сотрудникам: те же факты (`effectiveFacts`) и те же функции движка, что у игры. */
export function dayResults(s: Snapshot, date: DateStr): GroupLine[] {
  const tl = timelineOf(s);
  const cfg = tl.at(date);
  const start = cfg.startDate;
  const eff = effectiveFacts(s);
  const today = serverToday(s);
  const cfgToday = tl.at(today);
  const through = s.funnelThrough;
  const working = isWorkingDay(date, cfg);
  const evaluated = working && through !== null && date <= through;
  const views = correctionViews(s);
  const { states, rank } = buildFacts(s, today);
  const tv = groupFunnel(rank, date);

  const days = basket(date, cfg);
  const gameDays = dateRange(start, date);
  const workDays = workingDaysBetween(start, date, cfg);
  // воронка копится только по загруженным дням и не дальше выбранного
  const funnelEnd = through === null ? null : through < date ? through : date;
  const funnelDays = funnelEnd === null ? [] : dateRange(start, funnelEnd);
  const evalDays = funnelEnd === null ? [] : workingDaysBetween(start, funnelEnd, cfg);
  const inFunnel = (d: DateStr) => funnelEnd !== null && d >= start && d <= funnelEnd;
  const inGame = (d: DateStr) => d >= start && d <= date;
  const staff = new Map(s.staff.map((e) => [e.id, e]));

  // строки воронки с правками (все даты) и оплаты сотрудников по дням: файл + правки; в день отсекается нулём, в накоплении — один раз за период
  const rows = new Map(eff.funnel.map((f) => [byKey(f.employeeId, f.date), f]));
  const payRaw = new Map(eff.fileInvoices);
  for (const c of eff.paymentCorrections) payRaw.set(byKey(c.employeeId, c.date), (payRaw.get(byKey(c.employeeId, c.date)) ?? 0) + c.delta);
  const rawOf = (id: string, d: DateStr) => payRaw.get(byKey(id, d)) ?? 0;
  const payOf = (id: string, d: DateStr) => Math.max(0, rawOf(id, d));

  const employeeLine = (e: Employee): EmployeeLine => {
    const present = isPresent(e, date, s.absences);
    const level = levelOn(e, date);
    const norm = cfg.norms[level];
    const row = rows.get(byKey(e.id, date));
    const fileRow = eff.fileFunnel.get(byKey(e.id, date));
    const file = { quality: fileRow?.quality ?? 0, long: fileRow?.long ?? 0, payments: eff.fileInvoices.get(byKey(e.id, date)) ?? 0 };
    const current = { quality: row?.quality ?? 0, long: row?.long ?? 0, payments: payOf(e.id, date) };
    const own = (kind: Kind) => corrections(views, (v) => v.c.employeeId === e.id && v.c.kind === kind && v.c.date === date).corrected;

    const funnelCells = (kind: 'quality' | 'long') => {
      const day: Cell = {
        fact: current[kind], plan: evaluated ? (present ? norm[kind] : 0) : null,
        ...corrections(views, (v) => v.c.employeeId === e.id && v.c.kind === kind && v.c.date === date),
      };
      let planCents = 0;
      for (const x of evalDays) if (isPresent(e, x, s.absences)) planCents += cents(tl.at(x).norms[levelOn(e, x)][kind]);
      const total: Cell = {
        fact: funnelDays.reduce((a, x) => a + (rows.get(byKey(e.id, x))?.[kind] ?? 0), 0), plan: evalDays.length ? planCents / 100 : null,
        ...corrections(views, (v) => v.c.employeeId === e.id && v.c.kind === kind && inFunnel(v.c.date)),
      };
      return { day, total };
    };
    const quality = funnelCells('quality');
    const long = funnelCells('long');

    const basketFact = days.reduce((a, x) => a + payOf(e.id, x), 0);
    const payDayCell: Cell = {
      fact: basketFact, plan: working ? (present ? norm.payments : 0) : null,
      ...corrections(views, (v) => v.c.employeeId === e.id && v.c.kind === 'payments' && days.includes(v.c.date)),
      weekend: working ? basketFact - current.payments : 0,
    };
    let payPlanCents = 0;
    for (const x of workDays) if (isPresent(e, x, s.absences)) payPlanCents += cents(tl.at(x).norms[levelOn(e, x)].payments);
    const payTotalCell: Cell = {
      fact: Math.max(0, gameDays.reduce((a, x) => a + rawOf(e.id, x), 0)), plan: workDays.length ? payPlanCents / 100 : null,
      ...corrections(views, (v) => v.c.employeeId === e.id && v.c.kind === 'payments' && inGame(v.c.date)),
    };

    return {
      id: e.id, name: e.name, level, absence: absenceOn(s.absences, e.id, date), inGroupTotal: present, hidden: e.hiddenFromRating,
      day: { quality: quality.day, long: long.day, payments: payDayCell },
      total: { quality: quality.total, long: long.total, payments: payTotalCell },
      file, corrections: { quality: own('quality'), long: own('long'), payments: own('payments') }, current,
    };
  };

  return GROUPS.map((group) => {
    const result = evaluateDay(group, date, s.staff, s.absences, eff.funnel, cfg);
    const inGroup = (v: CorrectionView) => v.group === group;
    const present = (v: CorrectionView) => {
      const e = staff.get(v.c.employeeId);
      return !!e && isPresent(e, date, s.absences);
    };

    const planOf = (kind: 'normQuality' | 'normLong') => {
      let sum = 0;
      for (const x of evalDays) sum += cents(evaluateDay(group, x, s.staff, s.absences, [], tl.at(x))[kind]);
      return evalDays.length ? sum / 100 : null;
    };
    const byDay = eff.paymentsByDay[group];
    const payFact = sumDays(byDay, days);
    const payTotal = sumDays(byDay, gameDays);
    let payPlanCents = 0;
    for (const x of workDays) payPlanCents += paymentPlanCents(group, x, s.staff, s.absences, tl.at(x));
    const { gameCents } = groupPlan(group, date, s.staff, s.absences, tl.at, cfg);

    const day: Record<Kind, Cell> = {
      quality: {
        fact: result.factQuality, plan: evaluated ? result.normQuality : null,
        ...corrections(views, (v) => v.c.kind === 'quality' && v.c.date === date && inGroup(v) && present(v)),
      },
      long: {
        fact: result.factLong, plan: evaluated ? result.normLong : null,
        ...corrections(views, (v) => v.c.kind === 'long' && v.c.date === date && inGroup(v) && present(v)),
      },
      payments: {
        fact: payFact, plan: working ? paymentPlanCents(group, date, s.staff, s.absences, cfg) / 100 : null,
        ...corrections(views, (v) => v.c.kind === 'payments' && inGroup(v) && days.includes(v.c.date)),
        weekend: working ? payFact - (byDay[date] ?? 0) : 0,
      },
    };
    const total: Record<Kind, Cell> = {
      quality: { fact: tv[group].quality, plan: planOf('normQuality'), ...corrections(views, (v) => v.c.kind === 'quality' && inGroup(v) && inFunnel(v.c.date)) },
      long: { fact: tv[group].long, plan: planOf('normLong'), ...corrections(views, (v) => v.c.kind === 'long' && inGroup(v) && inFunnel(v.c.date)) },
      payments: {
        fact: payTotal, plan: workDays.length ? payPlanCents / 100 : null,
        ...corrections(views, (v) => v.c.kind === 'payments' && inGroup(v) && inGame(v.c.date)),
      },
    };

    // что даст оценка этого дня на следующий рабочий день (правила наград — в simulate; «−1 кучка» снимается и с нуля, как там)
    const outcome: Outcome = !working
      ? { evaluated: false, reason: 'weekend' }
      : !evaluated
        ? { evaluated: false, reason: 'no-funnel' }
        : {
          evaluated: true, result, medkit: result.longMet, pile: result.longRequired && !result.longMet,
          pileRemoved: result.longMet, toy: result.qualityMet, appliesOn: nextWorkingDay(date, cfg),
        };

    const employees = s.staff
      .filter((e) => groupOn(e, date) === group && isPresent(e, date, [])) // принят и ещё не уволен; отсутствующие остаются
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map(employeeLine);

    // вчерашний рабочий день для скуки: корзина оплат предыдущего рабочего дня, как у simulate
    const prev = prevWorkingDay(today, cfgToday);
    const yesterday = prev ? sumDays(byDay, basket(prev, cfgToday)) : null;
    const now = states[group];

    return {
      group, hero: THEME[group].species, day, total,
      gamePlanPercent: gameCents > 0 ? Math.floor((payTotal * 10000) / gameCents) : null,
      outcome, now, nowReason: moodReason(now, cfgToday, yesterday), employees,
      unassigned: {
        payments: payFact - employees.reduce((a, e) => a + e.day.payments.fact, 0),
        unmatched: days.reduce((a, x) => a + (eff.unmatched.get(`${group}|${x}`) ?? 0), 0),
      },
    };
  });
}

export interface CorrectionItem { date: DateStr; employeeId: string; kind: Kind; delta: number; base: number }

/**
 * Что отправить на сервер, чтобы у сотрудника за `date` стало `wanted` («сколько должно быть»): по правке на каждый изменённый
 * показатель, разница считается от сырого значения (файл + правки), `base` — значение «из файла». Ничего не изменилось — `[]`.
 */
export function correctionItems(line: EmployeeLine, wanted: Record<Kind, number>, date: DateStr): CorrectionItem[] | { error: string } {
  if (line.id.startsWith('new:')) return { error: 'Новый сотрудник появится после загрузки файла: сейчас поправить нельзя' };
  const items: CorrectionItem[] = [];
  for (const kind of KINDS) {
    const w = wanted[kind];
    if (!Number.isInteger(w) || w < 0) return { error: `${KIND_TITLE[kind]}: нужно целое число, не меньше 0` };
    if (w === line.current[kind]) continue;
    if (kind !== 'payments' && !line.inGroupTotal) return { error: `${KIND_TITLE[kind]}: сотрудник отсутствует, его воронка не входит в итог группы` };
    // от сырого значения (файл + правки), а не от показанного: отсечённый минус иначе оставил бы значение ниже цели
    const delta = w - (line.file[kind] + line.corrections[kind]);
    if (delta === 0) continue;
    if (Math.abs(delta) > MAX_DELTA) return { error: `${KIND_TITLE[kind]}: за один раз можно изменить не больше чем на ${MAX_DELTA}` };
    items.push({ date, employeeId: line.id, kind, delta, base: line.file[kind] });
  }
  return items;
}

const workDays = (n: number) => {
  const d = n % 10;
  const dd = n % 100;
  const word = d === 1 && dd !== 11 ? 'день' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'дня' : 'дней';
  return `${n} раб. ${word}`;
};

/**
 * Почему питомец в таком настроении (то, что решил `simulate`, пересказано словами). `yesterdayPayments` — оплаты группы за
 * прошлый рабочий день (корзина) или null, если его не было; нужны только для скуки.
 */
export function moodReason(state: PetState, cfg: Config, yesterdayPayments: number | null): string | null {
  switch (state.mood) {
    case 'dead':
      return 'погиб';
    case 'sick': {
      const parts: string[] = [];
      if (state.noPayDays >= cfg.sickDaysNoPay) parts.push(`${workDays(state.noPayDays)} без оплат`);
      if (state.piles > cfg.sickPilesAbove) parts.push(`кучек ${state.piles} (больше ${ruNum(cfg.sickPilesAbove)})`);
      return parts.length ? `болеет: ${parts.join(', ')}` : 'болеет';
    }
    case 'sad':
      return `грустит: кучек ${state.piles}`;
    case 'bored':
      return yesterdayPayments === null ? 'скучает' : `скучает: вчера оплат ${yesterdayPayments} (меньше ${ruNum(cfg.boredomBelow)})`;
    default:
      return null;
  }
}
