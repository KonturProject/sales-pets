import { describe, expect, test } from 'vitest';
import { defaultConfig } from '@/engine/config';
import { heroDays } from './RankingPanel';

const cfg = defaultConfig;

describe('heroDays (R8): рабочие дни для выбора и день по умолчанию', () => {
  test('середина игры: дни до asOf включительно, по умолчанию — предыдущий рабочий день', () => {
    expect(heroDays('2026-11-12', cfg)).toEqual({
      days: ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'],
      initial: '2026-11-11',
    });
  });

  test('понедельник и день после праздника: «вчера» — последний рабочий день, а не календарный', () => {
    expect(heroDays('2026-11-09', cfg).initial).toBe('2026-11-06');
    expect(heroDays('2026-11-05', cfg).initial).toBe('2026-11-03');
  });

  test('asOf на выходном: по умолчанию последний рабочий день перед ним', () => {
    const { days, initial } = heroDays('2026-11-07', cfg);
    expect(days.at(-1)).toBe('2026-11-06');
    expect(initial).toBe('2026-11-06');
  });

  test('до старта и в первый день героев ещё нет: дня по умолчанию нет', () => {
    expect(heroDays('2026-11-01', cfg)).toEqual({ days: [], initial: null });
    expect(heroDays('2026-11-02', cfg)).toEqual({ days: ['2026-11-02'], initial: null });
  });

  test('после конца игры все 14 рабочих дней, по умолчанию последний; мусор не зацикливает', () => {
    const { days, initial } = heroDays('9999-12-31', cfg);
    expect(days).toHaveLength(14);
    expect(initial).toBe('2026-11-20');
  });
});
