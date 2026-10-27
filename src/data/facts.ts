import { workingDaysBetween } from '@/engine/calendar';
import { evaluateDay } from '@/engine/evaluate';
import { simulate, type PetState } from '@/engine/pet';
import { uniqueInvoices, type PaymentRow, type RankData } from '@/engine/ranking';
import { normalizeName } from '@/engine/staff';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import type { Snapshot } from './api';
import { timelineOf } from './config';

export { normalizeName };

/** Дневная норма оплат группы для сытости, пока админка не задала свою (R9). */
export const DEFAULT_DAILY_NORM = 4;

export interface Facts {
  states: Record<GroupCode, PetState>;
  rank: RankData;
  /** Авторы оплат, которых нет в штате: оплата засчитана группе, в рейтинг не попала. */
  unmatchedAuthors: string[];
}

const cache = new WeakMap<Snapshot, Map<DateStr, Facts>>();

/**
 * Состояния групп и данные рейтингов из снимка на дату `asOf`; на пару «снимок, дата» считается один раз.
 * Нормы и пороги берутся из `config` снимка и его правок по датам (`configChanges`): день оценивается настройками своего дня.
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
  const idByName = new Map<string, string>();
  for (const e of s.staff) {
    const key = normalizeName(e.name);
    if (!idByName.has(key)) idByName.set(key, e.id);
  }

  // один счёт — одна оплата (R3, R4): группа оплаты — поле файла, рейтинг — по сотруднику
  const paymentsByDay = Object.fromEntries(GROUPS.map((g) => [g, {} as Record<DateStr, number>])) as Record<GroupCode, Record<DateStr, number>>;
  const rankPayments: PaymentRow[] = [];
  const unmatched = new Map<string, string>();
  for (const r of uniqueInvoices(s.payments, (p) => normalizeName(p.author))) {
    const day = paymentsByDay[r.group];
    if (!day) continue;
    day[r.date] = (day[r.date] ?? 0) + 1;
    const employeeId = idByName.get(normalizeName(r.author));
    if (employeeId !== undefined) rankPayments.push({ employeeId, date: r.date, invoice: r.invoice });
    else unmatched.set(normalizeName(r.author), r.author.trim().replace(/\s+/g, ' '));
  }

  // предварительные числа — только за дни и группы, которых импорт не покрыл (R2)
  const imported = new Set(s.payments.map((p) => `${p.date}|${p.group}`));
  for (const p of s.provisional) {
    const day = paymentsByDay[p.group];
    if (!day || imported.has(`${p.date}|${p.group}`)) continue;
    day[p.date] = (day[p.date] ?? 0) + p.count;
  }

  // дни после funnelThrough не оцениваем: воронки там ещё нет, нули не должны штрафовать (R1)
  const through = s.funnelThrough;
  const funnel = through === null ? [] : s.funnel.filter((f) => f.date <= through);
  const evalDays = through === null ? [] : workingDaysBetween(cfg.startDate, through < asOf ? through : asOf, cfg);
  const dailyNorm = timeline.dailyNormAt(asOf) ?? DEFAULT_DAILY_NORM;
  // правки одного дня движок применяет по порядку, а порядок — это id
  const byId = [...s.overrides].sort((a, b) => a.id - b.id);

  const states = Object.fromEntries(
    GROUPS.map((group) => {
      const results = Object.fromEntries(
        evalDays.map((date) => [date, evaluateDay(group, date, s.staff, s.absences, funnel, timeline.at(date))]),
      );
      const overrides = byId.filter((o) => o.group === group).map(({ date, kind, delta }) => ({ date, kind, delta }));
      return [group, simulate({ group, paymentsByDay: paymentsByDay[group], results, overrides, dailyNorm }, asOf, cfg, timeline.at)];
    }),
  ) as Record<GroupCode, PetState>;

  return {
    states,
    rank: { staff: s.staff, absences: s.absences, payments: rankPayments, funnel, cfg, cfgOn: timeline.at },
    unmatchedAuthors: [...unmatched.values()].sort(),
  };
}
