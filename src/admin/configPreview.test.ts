import { describe, expect, test } from 'vitest';
import type { Snapshot } from '@/data/api';
import { configPreview, describeChange, mergeConfig } from './configPreview';

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  version: 1, serverNow: '2026-11-12T10:00:00+03:00', funnelThrough: null, paymentsImportedThrough: null,
  config: {}, configChanges: [], staff: [], absences: [], payments: [], provisional: [], funnel: [], overrides: [], ...over,
});
/** У СР1 12 оплат на сегодня (по умолчанию это стадия 2: пороги 6 и 10), у остальных групп пусто. */
const withTwelve = (over: Partial<Snapshot> = {}) =>
  snap({ provisional: [{ date: '2026-11-12', group: 'СР1', count: 12 }], ...over });

describe('mergeConfig', () => {
  test('скаляры заменяются, нормы сливаются по уровню и полю, пороги заменяются целиком', () => {
    const raw = { maxPiles: 3, norms: { rookie1: { quality: 2, long: 1 } } };
    const patch = { dailyNorm: 7, norms: { rookie1: { long: 4 }, experienced: { quality: 9 } }, stageThresholds: [1, 2] };
    expect(mergeConfig(raw, patch)).toEqual({
      maxPiles: 3,
      dailyNorm: 7,
      norms: { rookie1: { quality: 2, long: 4 }, experienced: { quality: 9 } },
      stageThresholds: [1, 2],
    });
  });

  test('исходный объект не меняется', () => {
    const raw = { norms: { rookie1: { quality: 2 } } };
    mergeConfig(raw, { norms: { rookie1: { quality: 5 } } });
    expect(raw).toEqual({ norms: { rookie1: { quality: 2 } } });
  });
});

describe('configPreview', () => {
  test('поднятые пороги стадий опускают питомца: группа попадает в список со стадиями «было → станет»', () => {
    const s = withTwelve();
    const t = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160];
    const { asOf, changes } = configPreview(s, { stageThresholds: t });
    expect(asOf).toBe('2026-11-12');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ group: 'СР1', before: { alive: true, stage: 2 }, after: { alive: true, stage: 0 } });
  });

  test('запасы меняются без смены стадии: повышенная норма отнимает аптечку и игрушку, группа в списке', () => {
    const s = snap({
      serverNow: '2026-11-03T10:00:00+03:00',
      staff: [{ id: 'e1', name: 'Тест Иванов', shortName: 'Тест', group: 'СР1', hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [] }],
      funnelThrough: '2026-11-02',
      funnel: [{ employeeId: 'e1', date: '2026-11-02', quality: 5, long: 3 }],
    });
    const { changes } = configPreview(s, { norms: { experienced: { quality: 50, long: 50 } } });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ group: 'СР1', before: { medkits: 1, toys: 1 }, after: { medkits: 0, toys: 0 } });
  });

  test('правка, после которой у всех всё так же, даёт пустой список', () => {
    expect(configPreview(withTwelve(), { maxPiles: 5 }).changes).toEqual([]);
  });

  test('«сегодня» — по серверу снимка, а не по часам машины', () => {
    expect(configPreview(snap({ serverNow: '2026-11-20T23:30:00+03:00' }), { maxPiles: 5 }).asOf).toBe('2026-11-20');
  });

  test('снимок не меняется и кэш движка не подменяется', () => {
    const s = withTwelve();
    const before = JSON.stringify(s);
    configPreview(s, { stageThresholds: [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160] });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('describeChange', () => {
  const live = (stage: number, phase: 'pet' | 'egg0' = 'pet') => ({
    alive: true, phase, stage, totalPayments: 0, medkits: 0, toys: 0, piles: 0,
  });

  test('стадия, смерть и «яйцо» читаются по-человечески', () => {
    expect(describeChange({ group: 'СР1', before: live(7), after: live(5) })).toBe('СР1: стадия 7 → стадия 5');
    expect(describeChange({ group: 'СР2', before: live(2), after: live(0, 'egg0') })).toBe('СР2: стадия 2 → яйцо');
    expect(describeChange({ group: 'СР3', before: live(3), after: { ...live(3), alive: false } })).toBe('СР3: стадия 3 → погиб');
  });

  test('запасы и кучки называются, только если изменились', () => {
    const before = { ...live(4), medkits: 3, toys: 2, piles: 1 };
    expect(describeChange({ group: 'СР5', before, after: { ...before, medkits: 1, toys: 0 } })).toBe('СР5: аптечки 3 → 1; игрушки 2 → 0');
    expect(describeChange({ group: 'СР6', before, after: { ...live(3), medkits: 3, toys: 2, piles: 0 } })).toBe('СР6: стадия 4 → стадия 3; кучки 1 → 0');
  });
});
