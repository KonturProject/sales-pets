import { addDays, prevWorkingDay } from '@/engine/calendar';
import type { Config } from '@/engine/config';
import { uniqueInvoices } from '@/engine/ranking';
import { normalizeName, type Employee } from '@/engine/staff';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
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

/**
 * Строки превью оплат: счета по группам (как их посчитает экран: повтор счёта — одна оплата) и авторы, которых нет
 * в штате: их оплаты кормят питомца, но в рейтинг не попадают.
 */
export function paymentsSummary(rows: ImportedPayment[], staff: Employee[]): string[] {
  const known = new Set(staff.map((e) => normalizeName(e.name)));
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<GroupCode, number>;
  const unmatched = new Map<string, string>();
  const unique = uniqueInvoices(rows, (p) => normalizeName(p.author));
  let matched = 0;
  for (const r of unique) {
    if (r.group in byGroup) byGroup[r.group]++;
    const key = normalizeName(r.author);
    if (known.has(key)) matched++;
    else unmatched.set(key, r.author.trim().replace(/\s+/g, ' '));
  }
  const lines = [
    `По группам: ${GROUPS.map((g) => `${g} ${byGroup[g]}`).join(' · ')}`,
    `Привязано к сотрудникам: ${matched} из ${unique.length} оплат`,
  ];
  if (unmatched.size) {
    const names = [...unmatched.values()].sort((a, b) => a.localeCompare(b, 'ru'));
    lines.push(`Авторы не найдены в штате (${names.length}): ${names.join('; ')}. Их оплаты кормят питомца, но не идут в рейтинг: проверьте ФИО во вкладке «Сотрудники».`);
  }
  return lines;
}

export interface FunnelPlan {
  through: DateStr;
  rows: FunnelRow[];
  newStaff: { name: string; group: GroupCode }[];
  /** сотрудники вне шести групп: по данным парсера, на сервер не уходят */
  outside: number;
  /** строки файла позже `through`: на сервер не уходят */
  dropped: number;
  /** за `through` у всех нули: похоже, выгрузка сделана до обновления CRM */
  zeroThrough: boolean;
}

/** Первая загрузка воронки (дней игры до сегодняшнего в файле нет): из файла берётся только штат. */
export interface StaffOnlyPlan {
  staffOnly: true;
  /** разных сотрудников шести групп в файле */
  inFile: number;
  newStaff: FunnelPlan['newStaff'];
  outside: number;
}

/**
 * Данные воронки «по» предыдущий рабочий день, но не позже последней даты файла.
 * ФИО, которых нет в штате, возвращаются в `newStaff`: сервер отклоняет файл с неизвестным ФИО целиком.
 * В первый день игры (02.11: «вчера» игры ещё нет) файл даёт только штат; позже файл без дней игры — ошибка.
 */
export function planFunnelImport(
  parsed: ParsedFunnel,
  staff: Employee[],
  { today, config }: { today: DateStr; config: Config },
): FunnelPlan | StaffOnlyPlan | { error: string } {
  const known = new Set(staff.map((e) => normalizeName(e.name)));
  const newStaff: FunnelPlan['newStaff'] = [];
  for (const e of parsed.employees) {
    const key = normalizeName(e.name);
    if (known.has(key)) continue;
    known.add(key);
    newStaff.push({ name: e.name, group: e.group });
  }
  const previous = prevWorkingDay(today, config);
  if (previous === null) {
    if (!parsed.employees.length) return { error: 'В файле нет сотрудников шести групп' };
    if (!newStaff.length) return { error: 'Все сотрудники из файла уже в штате; показатели воронки загружаются со следующего рабочего дня' };
    const inFile = new Set(parsed.employees.map((e) => normalizeName(e.name))).size;
    return { staffOnly: true, inFile, newStaff, outside: parsed.outside };
  }
  if (parsed.lastDate === null) return { error: 'В файле нет дней игры до сегодняшнего' };
  const through = parsed.lastDate < previous ? parsed.lastDate : previous;
  if (through < config.startDate) return { error: 'В файле нет дней игры до сегодняшнего' };
  const rows = parsed.rows.filter((r) => r.date <= through);
  const zeroThrough = rows.filter((r) => r.date === through).every((r) => !r.quality && !r.long);
  return { through, rows, newStaff, outside: parsed.outside, dropped: parsed.rows.length - rows.length, zeroThrough };
}
