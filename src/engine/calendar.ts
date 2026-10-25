import type { Config } from './config';
import type { DateStr } from './types';

const DAY_MS = 86_400_000;
const toMs = (d: DateStr) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number): DateStr => new Date(ms).toISOString().slice(0, 10);

export function addDays(d: DateStr, n: number): DateStr {
  return fromMs(toMs(d) + n * DAY_MS);
}

export function isWorkingDay(d: DateStr, cfg: Config): boolean {
  if (d < cfg.startDate || d > cfg.endDate) return false;
  return !cfg.nonWorking.includes(d);
}

/** Ближайший рабочий день строго раньше d (внутри периода игры), иначе null. */
export function prevWorkingDay(d: DateStr, cfg: Config): DateStr | null {
  for (let x = addDays(d, -1); x >= cfg.startDate; x = addDays(x, -1)) {
    if (isWorkingDay(x, cfg)) return x;
  }
  return null;
}

/** Ближайший рабочий день строго позже d, иначе null. */
export function nextWorkingDay(d: DateStr, cfg: Config): DateStr | null {
  for (let x = addDays(d, 1); x <= cfg.endDate; x = addDays(x, 1)) {
    if (isWorkingDay(x, cfg)) return x;
  }
  return null;
}

export function workingDaysBetween(from: DateStr, to: DateStr, cfg: Config): DateStr[] {
  const out: DateStr[] = [];
  for (let x = from; x <= to; x = addDays(x, 1)) if (isWorkingDay(x, cfg)) out.push(x);
  return out;
}
