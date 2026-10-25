import type { Config } from './config';
import type { FunnelDay } from './evaluate';
import { countsInRating, groupOn, levelOn, type Absence, type Employee } from './staff';
import type { DateStr, GroupCode } from './types';

/** Оплата сотрудника: один уникальный счёт. */
export interface PaymentRow {
  employeeId: string;
  date: DateStr;
  invoice: string;
}

export interface RankRow {
  employeeId: string;
  name: string;
  group: GroupCode;
  /** ничья делит место: 1, 1, 3 */
  place: number;
  value: number;
}

export interface RankData {
  staff: Employee[];
  absences: Absence[];
  payments: PaymentRow[];
  funnel: FunnelDay[];
  cfg: Config;
}

interface Scored {
  e: Employee;
  group: GroupCode;
  value: number;
  /** добавочный критерий при равенстве value */
  tie: number;
}

function rank(items: Scored[], n?: number): RankRow[] {
  const sorted = [...items].sort(
    (a, b) => b.value - a.value || b.tie - a.tie || a.e.name.localeCompare(b.e.name, 'ru'),
  );
  let place = 0;
  const rows = sorted.map((s, i) => {
    const prev = sorted[i - 1];
    if (!prev || prev.value !== s.value || prev.tie !== s.tie) place = i + 1;
    return { employeeId: s.e.id, name: s.e.name, group: s.group, place, value: s.value };
  });
  return n === undefined ? rows : rows.slice(0, n);
}

/**
 * Засчитанные в рейтинг оплаты за период: сотрудник → группа на дату оплаты → число уникальных счетов.
 * Оплата, сделанная в день отсутствия или скрытым сотрудником, в рейтинг не идёт (группе она всё равно засчитана).
 */
function countedPayments(d: RankData, from: DateStr, to: DateStr): Map<string, Map<GroupCode, number>> {
  const byId = new Map(d.staff.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const result = new Map<string, Map<GroupCode, number>>();
  for (const p of d.payments) {
    if (p.date < from || p.date > to) continue;
    const key = `${p.employeeId}|${p.invoice}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const e = byId.get(p.employeeId);
    if (!e || !countsInRating(e, p.date, d.absences)) continue;
    const g = groupOn(e, p.date);
    const groups = result.get(e.id) ?? new Map<GroupCode, number>();
    groups.set(g, (groups.get(g) ?? 0) + 1);
    result.set(e.id, groups);
  }
  return result;
}

/** Рейтинг группы за период: участники группы на дату `to` (даже с нулём) и все, кто набрал очки в группе. */
export function groupRanking(group: GroupCode, from: DateStr, to: DateStr, d: RankData): RankRow[] {
  const counted = countedPayments(d, from, to);
  const items: Scored[] = [];
  for (const e of d.staff) {
    const value = counted.get(e.id)?.get(group) ?? 0;
    const member = groupOn(e, to) === group && countsInRating(e, to, d.absences);
    if (value > 0 || member) items.push({ e, group, value, tie: 0 });
  }
  return rank(items);
}

/** Общий топ по всем группам; сотрудники без засчитанных оплат не показываются. */
export function topOverall(from: DateStr, to: DateStr, d: RankData, n = 10): RankRow[] {
  const counted = countedPayments(d, from, to);
  const items: Scored[] = [];
  for (const e of d.staff) {
    const groups = counted.get(e.id);
    const value = groups ? [...groups.values()].reduce((a, b) => a + b, 0) : 0;
    if (value > 0) items.push({ e, group: groupOn(e, to), value, tie: 0 });
  }
  return rank(items, n);
}

/**
 * Герои дня: процент выполнения личной нормы (качественные и длинные по воронке, перевыполнение одной
 * не закрывает другую), при равенстве — больше оплат за день. Нулевой результат не показывается.
 */
export function heroesOfDay(date: DateStr, d: RankData, n = 10): RankRow[] {
  const payments = countedPayments(d, date, date);
  const funnel = new Map<string, { quality: number; long: number }>();
  for (const row of d.funnel) {
    if (row.date !== date) continue;
    const acc = funnel.get(row.employeeId) ?? { quality: 0, long: 0 };
    acc.quality += row.quality;
    acc.long += row.long;
    funnel.set(row.employeeId, acc);
  }
  const items: Scored[] = [];
  for (const e of d.staff) {
    if (!countsInRating(e, date, d.absences)) continue;
    const norm = d.cfg.norms[levelOn(e, date)];
    const total = norm.quality + norm.long;
    const fact = funnel.get(e.id);
    if (total === 0 || !fact) continue;
    const done = Math.min(fact.quality, norm.quality) + Math.min(fact.long, norm.long);
    const value = Math.round((done / total) * 100);
    if (value === 0) continue;
    const tie = [...(payments.get(e.id)?.values() ?? [])].reduce((a, b) => a + b, 0);
    items.push({ e, group: groupOn(e, date), value, tie });
  }
  return rank(items, n);
}
