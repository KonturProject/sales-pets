import { describe, expect, test } from 'vitest';
import type { Snapshot } from '@/data/api';
import { todayLine } from './today';

const snap = (o: Partial<Snapshot>): Snapshot => ({
  version: 1, serverNow: '2026-11-03T10:00:00+03:00', funnelThrough: null, paymentsImportedThrough: null,
  config: {}, configChanges: [], staff: [], absences: [], payments: [], provisional: [], funnel: [], overrides: [], ...o,
});

describe('todayLine: блок «Сегодня» над вкладками админки', () => {
  test('день игры: что загружено и сколько групп внесли предварительные числа сегодня', () => {
    const s = snap({
      funnelThrough: '2026-11-02',
      paymentsImportedThrough: '2026-11-02',
      provisional: [
        { date: '2026-11-03', group: 'СР1', count: 2 },
        { date: '2026-11-03', group: 'СР2', count: 0 },
        { date: '2026-11-02', group: 'СР3', count: 5 },
      ],
    });
    expect(todayLine(s)).toBe('Сегодня 03.11 · день 2 из 14 · воронка по 02.11 · оплаты из файла по 02.11 · предварительные сегодня: 2 из 6 групп');
  });

  test('до старта, пустая таблица', () => {
    expect(todayLine(snap({ serverNow: '2026-11-01T18:00:00+03:00' })))
      .toBe('Сегодня 01.11 · старт 02.11 · воронки ещё нет · оплат из файла ещё нет · предварительные сегодня: 0 из 6 групп');
  });

  test('после конца игры', () => {
    expect(todayLine(snap({ serverNow: '2026-11-23T09:00:00+03:00' }))).toContain('Сегодня 23.11 · игра окончена');
  });
});
