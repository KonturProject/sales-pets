import { describe, expect, test } from 'vitest';
import { defaultConfig } from './config';
import { isWorkingDay, prevWorkingDay, nextWorkingDay, addDays, parseDate, workingDaysBetween } from './calendar';

const cfg = defaultConfig;

describe('calendar', () => {
  test('нерабочие дни из спеки', () => {
    expect(isWorkingDay('2026-11-04', cfg)).toBe(false);
    expect(isWorkingDay('2026-11-05', cfg)).toBe(true);
    expect(isWorkingDay('2026-11-08', cfg)).toBe(false);
    expect(isWorkingDay('2026-11-21', cfg)).toBe(false);
  });
  test('вне периода игры день нерабочий', () => {
    expect(isWorkingDay('2026-11-01', cfg)).toBe(false);
    expect(isWorkingDay('2026-11-23', cfg)).toBe(false);
  });
  test('prevWorkingDay: после праздника и выходных', () => {
    expect(prevWorkingDay('2026-11-09', cfg)).toBe('2026-11-06');
    expect(prevWorkingDay('2026-11-05', cfg)).toBe('2026-11-03');
  });
  test('nextWorkingDay', () => {
    expect(nextWorkingDay('2026-11-03', cfg)).toBe('2026-11-05');
    expect(nextWorkingDay('2026-11-06', cfg)).toBe('2026-11-09');
  });
  test('addDays через границу месяца', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
  test('workingDaysBetween включает обе границы', () => {
    expect(workingDaysBetween('2026-11-02', '2026-11-09', cfg)).toEqual(
      ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-09']);
  });
  test('14 рабочих дней за игру (21 день минус 6 выходных и 4.11)', () => {
    expect(workingDaysBetween(cfg.startDate, cfg.endDate, cfg)).toHaveLength(14);
  });
});

describe('мусорные даты не вешают расчёт', () => {
  test('workingDaysBetween не идёт дальше конца игры, даже если `to` — не дата', () => {
    const all = workingDaysBetween(cfg.startDate, cfg.endDate, cfg);
    expect(workingDaysBetween(cfg.startDate, 'today', cfg)).toEqual(all);
    expect(workingDaysBetween(cfg.startDate, '9999-12-31', cfg)).toEqual(all);
  });
  test('parseDate принимает только существующий день в формате yyyy-MM-dd', () => {
    expect(parseDate('2026-11-12', '2026-11-02')).toBe('2026-11-12');
    for (const bad of [null, '', 'today', '2026-11-1', '2026-13-01', '2026-02-30', '12.11.2026', '+010000-01-01']) {
      expect(parseDate(bad, '2026-11-02')).toBe('2026-11-02');
    }
  });
});
