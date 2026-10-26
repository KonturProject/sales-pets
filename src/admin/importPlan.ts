import { addDays, prevWorkingDay } from '@/engine/calendar';
import type { Config } from '@/engine/config';
import { normalizeName, type Employee } from '@/engine/staff';
import type { DateStr, GroupCode } from '@/engine/types';
import type { ParsedFunnel, FunnelRow } from '@/import/funnel';
import type { ImportedPayment } from '@/import/payments';

export interface PaymentsPlan {
  from: DateStr;
  to: DateStr;
  rows: ImportedPayment[];
  /** оплаты файла вне периода загрузки (сегодня и позже, «хвост» до старта игры): на сервер не уходят */
  dropped: number;
}

/**
 * Период загрузки оплат: от старта игры (или первой даты файла) до вчера (или последней даты файла).
 * Сервер принимает только дни строго до своего «сегодня», поэтому `today` — `serverToday(snapshot)` (R23).
 */
export function planPaymentsImport(
  parsed: { rows: ImportedPayment[] },
  { today, startDate }: { today: DateStr; startDate: DateStr },
): PaymentsPlan | { error: string } {
  const first = parsed.rows[0]?.date;
  const last = parsed.rows.at(-1)?.date;
  if (first === undefined || last === undefined) return { error: 'В файле нет оплат' };
  const yesterday = addDays(today, -1);
  const from = first > startDate ? first : startDate;
  const to = last < yesterday ? last : yesterday;
  if (from > to) return { error: 'В файле нет оплат за прошедшие дни игры' };
  const rows = parsed.rows.filter((r) => r.date >= from && r.date <= to);
  return { from, to, rows, dropped: parsed.rows.length - rows.length };
}

export interface FunnelPlan {
  through: DateStr;
  rows: FunnelRow[];
  newStaff: { name: string; group: GroupCode }[];
  /** сотрудники вне шести групп: по данным парсера, на сервер не уходят */
  outside: number;
  /** строки файла позже `through`: на сервер не уходят */
  dropped: number;
}

/**
 * Данные воронки «по» предыдущий рабочий день, но не позже последней даты файла.
 * ФИО, которых нет в штате, возвращаются в `newStaff`: сервер отклоняет файл с неизвестным ФИО целиком.
 */
export function planFunnelImport(
  parsed: ParsedFunnel,
  staff: Employee[],
  { today, config }: { today: DateStr; config: Config },
): FunnelPlan | { error: string } {
  const previous = prevWorkingDay(today, config);
  if (parsed.lastDate === null || previous === null) return { error: 'В файле нет дней игры до сегодняшнего' };
  const through = parsed.lastDate < previous ? parsed.lastDate : previous;
  if (through < config.startDate) return { error: 'В файле нет дней игры до сегодняшнего' };
  const known = new Set(staff.map((e) => normalizeName(e.name)));
  const newStaff: FunnelPlan['newStaff'] = [];
  for (const e of parsed.employees) {
    const key = normalizeName(e.name);
    if (known.has(key)) continue;
    known.add(key);
    newStaff.push({ name: e.name, group: e.group });
  }
  const rows = parsed.rows.filter((r) => r.date <= through);
  return { through, rows, newStaff, outside: parsed.outside, dropped: parsed.rows.length - rows.length };
}
