import { addDays } from './calendar';
import type { DateStr, GroupCode, Level } from './types';

export interface Employee {
  id: string;
  name: string;
  shortName: string;
  group: GroupCode;
  hireDate: DateStr | null;
  fireDate: DateStr | null;
  baseLevel: Level;
  hiddenFromRating: boolean;
  transfers: { date: DateStr; group: GroupCode }[];
}

export interface Absence {
  employeeId: string;
  kind: 'vacation' | 'sick' | 'other';
  from: DateStr;
  to: DateStr | null;
}

/** Ключ сопоставления ФИО из внешних файлов с сотрудником: без краёв и двойных пробелов, без регистра. */
export function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function groupOn(e: Employee, d: DateStr): GroupCode {
  let g = e.group;
  let at = '';
  for (const t of e.transfers) if (t.date <= d && t.date > at) { g = t.group; at = t.date; }
  return g;
}

/** Новичок: 7 дней неделя 1, 7 дней неделя 2, затем опытный. Без даты выхода — базовый уровень. */
export function levelOn(e: Employee, d: DateStr): Level {
  if (!e.hireDate || e.baseLevel === 'experienced') return e.baseLevel;
  if (d < addDays(e.hireDate, 7)) return 'rookie1';
  if (d < addDays(e.hireDate, 14)) return 'rookie2';
  return 'experienced';
}

export function isPresent(e: Employee, d: DateStr, absences: Absence[]): boolean {
  if (e.hireDate && d < e.hireDate) return false;
  if (e.fireDate && d >= e.fireDate) return false;
  return !absences.some((a) => a.employeeId === e.id && a.from <= d && (a.to === null || d <= a.to));
}

export function countsInRating(e: Employee, d: DateStr, absences: Absence[]): boolean {
  return isPresent(e, d, absences) && !e.hiddenFromRating;
}
