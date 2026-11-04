import type { Snapshot } from '@/data/api';
import { addDays, isWorkingDay } from '@/engine/calendar';
import type { Config } from '@/engine/config';
import type { DateStr } from '@/engine/types';
import { effectsOf, type Effects } from './effects';

/** День календаря игры: `off` — выходной. */
export interface CalendarDay { date: DateStr; off: boolean }

/**
 * Дни игры по неделям, пн–вс. Даты игры (02.11 — понедельник, 22.11 — воскресенье) админка не меняет, так что недели
 * целые: три строки по семь дней. Для другого периода крайние недели были бы короче, пустых клеток нет.
 */
export function calendarWeeks(cfg: Config): CalendarDay[][] {
  const weeks: CalendarDay[][] = [];
  for (let date = cfg.startDate; date <= cfg.endDate; date = addDays(date, 1)) {
    const monday = new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
    if (weeks.length === 0 || monday) weeks.push([]);
    weeks[weeks.length - 1].push({ date, off: !isWorkingDay(date, cfg) });
  }
  return weeks;
}

/** Список выходных с переключённым днём: добавлен или убран, отсортирован; исходный не меняется. */
export const toggleDay = (list: DateStr[], day: DateStr): DateStr[] =>
  (list.includes(day) ? list.filter((d) => d !== day) : [...list, day]).sort();

/** Что изменится в списке: дни, которые станут выходными (`added`), и дни, которые станут рабочими (`removed`). */
export const calendarChanges = (saved: DateStr[], draft: DateStr[]): { added: DateStr[]; removed: DateStr[] } => ({
  added: draft.filter((d) => !saved.includes(d)).sort(),
  removed: saved.filter((d) => !draft.includes(d)).sort(),
});

/**
 * Что изменится, если выходными станут `nonWorking`: итоги уже оценённых дней, питомцы сегодня. Снимок не меняется:
 * «после» — его копия с другим календарём (расчёты по снимку кэшируются на сам объект).
 */
export const calendarPreview = (s: Snapshot, nonWorking: DateStr[]): Effects =>
  effectsOf(s, { ...s, config: { ...s.config, nonWorking } });
