import { describe, expect, test } from 'vitest';
import type { Snapshot } from '@/data/api';
import { configOf } from '@/data/config';
import { defaultConfig } from '@/engine/config';
import type { Employee } from '@/engine/staff';
import type { DateStr } from '@/engine/types';
import { describeChange } from './configPreview';
import { calendarChanges, calendarPreview, calendarWeeks, toggleDay } from './calendarForm';
import { dayChangeText } from './effects';

const emp = (id: string, name: string): Employee => ({
  id, name, shortName: name, group: 'СР1', hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [],
});
const fun = (employeeId: string, date: DateStr, quality: number, long: number) => ({ employeeId, date, quality, long });
const pay = (date: DateStr, n: number) => ({ date, group: 'СР1' as const, author: 'Тест Альфов', invoice: `P-${date}-${n}` });

/**
 * Вымышленный мир: сегодня 05.11, воронка загружена по 04.11 — это встроенный выходной. Альфов (СР1, опытный: нормы по
 * умолчанию 5 качественных, 3 длинных) выполнил норму 02 и 03.11, а за выходное 04.11 в воронке стоят нули (отчёт
 * выгружен и за него). Оплат хватает на вылупление.
 */
const world = (over: Partial<Snapshot> = {}): Snapshot => ({
  version: 1, serverNow: '2026-11-05T10:00:00+03:00', funnelThrough: '2026-11-04', paymentsImportedThrough: '2026-11-04',
  config: {}, configChanges: [],
  staff: [emp('a1', 'Тест Альфов')],
  absences: [], provisional: [], overrides: [],
  payments: [1, 2, 3].map((n) => pay('2026-11-02', n)).concat([1, 2, 3].map((n) => pay('2026-11-03', n))),
  funnel: [fun('a1', '2026-11-02', 5, 3), fun('a1', '2026-11-03', 5, 3), fun('a1', '2026-11-04', 0, 0)],
  ...over,
});
const without = (list: DateStr[], day: DateStr) => list.filter((d) => d !== day);

describe('calendarWeeks: дни игры сеткой по неделям', () => {
  const weeks = calendarWeeks(defaultConfig);

  test('02.11.2026 — понедельник первой строки, три недели по семь дней, последний день — воскресенье 22.11', () => {
    expect(weeks).toHaveLength(3);
    expect(weeks.map((w) => w.length)).toEqual([7, 7, 7]);
    expect(weeks[0][0].date).toBe('2026-11-02');
    expect(weeks[1][0].date).toBe('2026-11-09');
    expect(weeks[2][6].date).toBe('2026-11-22');
    expect(new Date('2026-11-02T00:00:00Z').getUTCDay()).toBe(1);
  });

  test('встроенные выходные отмечены, остальные дни рабочие', () => {
    const off = weeks.flat().filter((d) => d.off).map((d) => d.date);
    expect(off).toEqual(defaultConfig.nonWorking);
    expect(off).toEqual(['2026-11-04', '2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15', '2026-11-21', '2026-11-22']);
    expect(weeks[0].map((d) => d.off)).toEqual([false, false, true, false, false, true, true]);
  });

  test('календарь берётся из настроек: заданный список и пустой список («выходных нет»)', () => {
    const custom = configOf({ nonWorking: ['2026-11-05', '2026-11-06'] });
    expect(calendarWeeks(custom).flat().filter((d) => d.off).map((d) => d.date)).toEqual(['2026-11-05', '2026-11-06']);
    expect(calendarWeeks(configOf({ nonWorking: [] })).flat().some((d) => d.off)).toBe(false);
  });
});

describe('toggleDay и calendarChanges', () => {
  test('переключение добавляет и убирает день, список остаётся отсортированным, исходный не меняется', () => {
    const list = ['2026-11-04', '2026-11-08'];
    expect(toggleDay(list, '2026-11-05')).toEqual(['2026-11-04', '2026-11-05', '2026-11-08']);
    expect(toggleDay(list, '2026-11-04')).toEqual(['2026-11-08']);
    expect(list).toEqual(['2026-11-04', '2026-11-08']);
  });

  test('calendarChanges: какие дни станут выходными и какие рабочими; одинаковые списки — пусто', () => {
    expect(calendarChanges(['2026-11-04', '2026-11-07'], ['2026-11-05', '2026-11-07'])).toEqual({ added: ['2026-11-05'], removed: ['2026-11-04'] });
    expect(calendarChanges(['2026-11-04'], ['2026-11-04'])).toEqual({ added: [], removed: [] });
  });
});

describe('calendarPreview: что изменится, если выходные станут такими', () => {
  test('прошлый выходной сделали рабочим, а воронка за него загружена нулями: группа получает «+1 кучка»', () => {
    const s = world();
    const { days, now } = calendarPreview(s, without(defaultConfig.nonWorking, '2026-11-04'));
    expect(days).toEqual([{ group: 'СР1', date: '2026-11-04', before: 'выходной', after: '+1 кучка, нет игрушки' }]);
    expect(dayChangeText(days[0])).toBe('СР1 04.11: выходной → +1 кучка, нет игрушки');
    expect(now.map((c) => c.group)).toEqual(['СР1']);
    expect(describeChange(now[0])).toContain('кучки');
  });

  test('рабочий день сделали выходным: его итог исчезает — «было → выходной»', () => {
    const { days } = calendarPreview(world(), [...defaultConfig.nonWorking, '2026-11-03'].sort());
    expect(days).toEqual([{ group: 'СР1', date: '2026-11-03', before: 'аптечка, игрушка', after: 'выходной' }]);
  });

  test('день, ещё не оценённый (воронки за него нет), в «итогах дней» не появляется; сегодняшний день тоже можно сделать выходным', () => {
    const s = world();
    const preview = calendarPreview(s, [...defaultConfig.nonWorking, '2026-11-05', '2026-11-09'].sort());
    expect(preview.days).toEqual([]);
    expect(preview.stale).toEqual([]);
  });

  test('список не изменился — три пустых списка', () => {
    expect(calendarPreview(world(), defaultConfig.nonWorking)).toEqual({ days: [], now: [], stale: [] });
  });

  test('снимок не меняется, а чтения по нему остаются прежними', () => {
    const s = world();
    const copy = structuredClone(s);
    const first = calendarPreview(s, without(defaultConfig.nonWorking, '2026-11-04'));
    expect(s).toEqual(copy);
    expect(calendarPreview(s, without(defaultConfig.nonWorking, '2026-11-04'))).toEqual(first);
    expect(calendarPreview(s, defaultConfig.nonWorking)).toEqual({ days: [], now: [], stale: [] }); // кэш снимка не испорчен предыдущим расчётом
  });
});
