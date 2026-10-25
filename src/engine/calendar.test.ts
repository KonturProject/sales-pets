import { describe, expect, test } from 'vitest';
import { defaultConfig } from './config';
import { isWorkingDay, prevWorkingDay, nextWorkingDay, addDays, workingDaysBetween } from './calendar';

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
