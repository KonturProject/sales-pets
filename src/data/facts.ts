import { workingDaysBetween } from '@/engine/calendar';
import { evaluateDay, groupPlan, type FunnelDay } from '@/engine/evaluate';
import { simulate, type PetState } from '@/engine/pet';
import { uniqueInvoices, type PaymentRow, type RankData } from '@/engine/ranking';
import { groupOn, normalizeName } from '@/engine/staff';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import type { Snapshot } from './api';
import { timelineOf } from './config';

export { normalizeName };

export interface Facts {
  states: Record<GroupCode, PetState>;
  rank: RankData;
  /** Авторы оплат, которых нет в штате: оплата засчитана группе, в рейтинг не попала. */
  unmatchedAuthors: string[];
}

/** Факты снимка после правок: один источник для оценки, рейтингов, табло и «Итогов». Ключи `${employeeId}|${date}`, `${group}|${date}`. */
export interface EffectiveFacts {
  /** файл + правки, ≥ 0, все даты (отсечение по funnelThrough — у потребителя) */
  funnel: FunnelDay[];
  /** воронка из файла без правок (то, с чем сверяется `base` правки) */
  fileFunnel: Map<string, { quality: number; long: number }>;
  /** оплаты группы по дням: файл (уникальные счета) + предварительные + правки, ≥ 0 */
  paymentsByDay: Record<GroupCode, Record<DateStr, number>>;
  /** уникальные счета сотрудника за день по автору (из файла) */
  fileInvoices: Map<string, number>;
  /** оплаты авторов не из штата по группе и дню */
  unmatched: Map<string, number>;
  rankPayments: PaymentRow[];
  paymentCorrections: { employeeId: string; date: DateStr; delta: number }[];
}

/** То же плюс имена авторов не из штата: нужны только `buildFacts`, наружу `effectiveFacts` их не отдаёт. */
interface Collected extends EffectiveFacts {
  unmatchedAuthors: string[];
}

const effectiveCache = new WeakMap<Snapshot, Collected>();

/** Факты снимка после ручных правок (`corrections`); на объект снимка считаются один раз. */
export function effectiveFacts(s: Snapshot): EffectiveFacts {
  return collect(s);
}

function collect(s: Snapshot): Collected {
  const hit = effectiveCache.get(s);
  if (hit) return hit;
  const facts = gather(s);
  effectiveCache.set(s, facts);
  return facts;
}

const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);

function gather(s: Snapshot): Collected {
  const byId = new Map(s.staff.map((e) => [e.id, e]));
  const idByName = new Map<string, string>();
  for (const e of s.staff) {
    const key = normalizeName(e.name);
    if (!idByName.has(key)) idByName.set(key, e.id);
  }

  // один счёт — одна оплата (R3, R4): группа оплаты — поле файла, рейтинг — по сотруднику
  const paymentsByDay = Object.fromEntries(GROUPS.map((g) => [g, {} as Record<DateStr, number>])) as Record<GroupCode, Record<DateStr, number>>;
  const rankPayments: PaymentRow[] = [];
  const fileInvoices = new Map<string, number>();
  const unmatched = new Map<string, number>();
  const unmatchedNames = new Map<string, string>();
  for (const r of uniqueInvoices(s.payments, (p) => normalizeName(p.author))) {
    const day = paymentsByDay[r.group];
    if (!day) continue;
    day[r.date] = (day[r.date] ?? 0) + 1;
    const employeeId = idByName.get(normalizeName(r.author));
    if (employeeId !== undefined) {
      rankPayments.push({ employeeId, date: r.date, invoice: r.invoice });
      bump(fileInvoices, `${employeeId}|${r.date}`);
    } else {
      bump(unmatched, `${r.group}|${r.date}`);
      unmatchedNames.set(normalizeName(r.author), r.author.trim().replace(/\s+/g, ' '));
    }
  }

  // предварительные числа — только за дни и группы, которых импорт не покрыл (R2)
  const imported = new Set(s.payments.map((p) => `${p.date}|${p.group}`));
  for (const p of s.provisional) {
    const day = paymentsByDay[p.group];
    if (!day || imported.has(`${p.date}|${p.group}`)) continue;
    day[p.date] = (day[p.date] ?? 0) + p.count;
  }

  // воронка из файла по паре «сотрудник, день» (повторы строк складываются, как в оценке дня)
  const rows = new Map<string, FunnelDay>();
  for (const f of s.funnel) {
    const key = `${f.employeeId}|${f.date}`;
    const row = rows.get(key);
    if (row) { row.quality += f.quality; row.long += f.long; } else rows.set(key, { ...f });
  }
  const fileFunnel = new Map([...rows].map(([key, r]) => [key, { quality: r.quality, long: r.long }]));

  // правки: суммы складываются, и только потом значение отсекается снизу нулём
  const paymentCorrections: EffectiveFacts['paymentCorrections'] = [];
  const paymentShift = Object.fromEntries(GROUPS.map((g) => [g, {} as Record<DateStr, number>])) as Record<GroupCode, Record<DateStr, number>>;
  const touched = new Set<FunnelDay>();
  for (const c of s.corrections ?? []) {
    const e = byId.get(c.employeeId);
    if (!e) continue; // сотрудника нет в штате: ни группы, ни рейтинга
    if (c.kind === 'payments') {
      paymentCorrections.push({ employeeId: c.employeeId, date: c.date, delta: c.delta });
      const shift = paymentShift[groupOn(e, c.date)];
      if (shift) shift[c.date] = (shift[c.date] ?? 0) + c.delta;
    } else {
      const key = `${c.employeeId}|${c.date}`;
      let row = rows.get(key);
      if (!row) rows.set(key, (row = { employeeId: c.employeeId, date: c.date, quality: 0, long: 0 }));
      row[c.kind] += c.delta;
      touched.add(row);
    }
  }
  for (const row of touched) {
    row.quality = Math.max(0, row.quality);
    row.long = Math.max(0, row.long);
  }
  for (const g of GROUPS) {
    for (const [date, sum] of Object.entries(paymentShift[g])) paymentsByDay[g][date] = Math.max(0, (paymentsByDay[g][date] ?? 0) + sum);
  }

  return {
    funnel: [...rows.values()], fileFunnel, paymentsByDay, fileInvoices, unmatched, rankPayments, paymentCorrections,
    unmatchedAuthors: [...unmatchedNames.values()].sort(),
  };
}

const cache = new WeakMap<Snapshot, Map<DateStr, Facts>>();

/**
 * Состояния групп и данные рейтингов из снимка на дату `asOf`; на пару «снимок, дата» считается один раз.
 * Нормы и пороги берутся из `config` снимка и его правок по датам (`configChanges`): день оценивается настройками своего дня.
 * Факты — после ручных правок (`effectiveFacts`).
 */
export function buildFacts(s: Snapshot, asOf: DateStr): Facts {
  const hit = cache.get(s)?.get(asOf);
  if (hit) return hit;
  const facts = compute(s, asOf);
  let byDate = cache.get(s);
  if (!byDate) cache.set(s, (byDate = new Map()));
  byDate.set(asOf, facts);
  return facts;
}

function compute(s: Snapshot, asOf: DateStr): Facts {
  const timeline = timelineOf(s);
  const cfg = timeline.at(asOf);
  const eff = collect(s);

  // дни после funnelThrough не оцениваем: воронки там ещё нет, нули не должны штрафовать (R1)
  const through = s.funnelThrough;
  const funnel = through === null ? [] : eff.funnel.filter((f) => f.date <= through);
  const evalDays = through === null ? [] : workingDaysBetween(cfg.startDate, through < asOf ? through : asOf, cfg);
  // правки одного дня движок применяет по порядку, а порядок — это id
  const byId = [...s.overrides].sort((a, b) => a.id - b.id);

  const states = Object.fromEntries(
    GROUPS.map((group) => {
      const results = Object.fromEntries(
        evalDays.map((date) => [date, evaluateDay(group, date, s.staff, s.absences, funnel, timeline.at(date))]),
      );
      const overrides = byId.filter((o) => o.group === group).map(({ date, kind, delta }) => ({ date, kind, delta }));
      const plan = groupPlan(group, asOf, s.staff, s.absences, timeline.at, cfg);
      return [group, simulate({ group, paymentsByDay: eff.paymentsByDay[group], results, overrides, plan }, asOf, cfg, timeline.at)];
    }),
  ) as Record<GroupCode, PetState>;

  return {
    states,
    rank: {
      staff: s.staff, absences: s.absences, payments: eff.rankPayments, funnel, cfg, cfgOn: timeline.at,
      paymentCorrections: eff.paymentCorrections,
    },
    unmatchedAuthors: eff.unmatchedAuthors,
  };
}
