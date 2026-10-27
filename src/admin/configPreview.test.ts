import { describe, expect, test } from 'vitest';
import type { Snapshot } from '@/data/api';
import { applyPatch, configPreview, describeChange, describeEntry, mergeConfig, removalPreview, removeChange } from './configPreview';

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

describe('applyPatch / removeChange (клиентское зеркало записи сервера)', () => {
  const state = (config = {}, configChanges: Snapshot['configChanges'] = []) => ({ config, configChanges });

  test('без даты — слияние в config', () => {
    expect(applyPatch(state({ maxPiles: 3 }), { sickDaysNoPay: 4 })).toEqual(state({ maxPiles: 3, sickDaysNoPay: 4 }));
  });

  test('с датой — запись по возрастанию даты, config не трогается, повтор той же даты сливается', () => {
    const a = applyPatch(state({ maxPiles: 3 }), { maxPiles: 2, norms: { experienced: { quality: 1 } } }, '2026-11-12');
    const b = applyPatch(a, { maxPiles: 1 }, '2026-11-09');
    const c = applyPatch(b, { norms: { experienced: { long: 2 } } }, '2026-11-12');
    expect(c.config).toEqual({ maxPiles: 3 });
    expect(c.configChanges).toEqual([
      { from: '2026-11-09', config: { maxPiles: 1 } },
      { from: '2026-11-12', config: { maxPiles: 2, norms: { experienced: { quality: 1, long: 2 } } } },
    ]);
  });

  test('правка на всю игру вычёркивает свои поля из записей, опустевшие записи удаляются', () => {
    const s = state({}, [
      { from: '2026-11-09', config: { maxPiles: 2, norms: { experienced: { quality: 1 } } } },
      { from: '2026-11-12', config: { sickDaysNoPay: 3 } },
    ]);
    const first = applyPatch(s, { maxPiles: 6 });
    expect(first.configChanges).toEqual([
      { from: '2026-11-09', config: { norms: { experienced: { quality: 1 } } } },
      { from: '2026-11-12', config: { sickDaysNoPay: 3 } },
    ]);
    expect(applyPatch(first, { norms: { experienced: { quality: 3 } } }).configChanges).toEqual([{ from: '2026-11-12', config: { sickDaysNoPay: 3 } }]);
    expect(applyPatch(s, { stageThresholds: Array.from({ length: 15 }, (_, i) => i + 1) }).configChanges).toEqual(s.configChanges);
  });

  test('removeChange убирает запись по дате; исходное состояние не меняется', () => {
    const s = state({}, [{ from: '2026-11-09', config: { maxPiles: 2 } }, { from: '2026-11-12', config: { maxPiles: 3 } }]);
    const before = JSON.stringify(s);
    expect(removeChange(s, '2026-11-09').configChanges).toEqual([{ from: '2026-11-12', config: { maxPiles: 3 } }]);
    applyPatch(s, { maxPiles: 6 });
    applyPatch(s, { maxPiles: 1 }, '2026-11-09');
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('configPreview с датой', () => {
  const staff = [{ id: 'e1', name: 'Тест Иванов', shortName: 'Тест', group: 'СР1' as const, hireDate: null, fireDate: null, baseLevel: 'experienced' as const, hiddenFromRating: false, transfers: [] }];
  /** 3 ноября (вторник), воронка по 2 ноября: день 2 ноября выполнен нормой опытного (5 и 3) → у СР1 по аптечке и игрушке. */
  const early = (over: Partial<Snapshot> = {}) => snap({
    serverNow: '2026-11-03T10:00:00+03:00', staff, funnelThrough: '2026-11-02',
    funnel: [{ employeeId: 'e1', date: '2026-11-02', quality: 5, long: 3 }], ...over,
  });
  const raise = { norms: { experienced: { quality: 50, long: 50 } } };

  test('дата в прошлом: оценённые дни считаются до funnelThrough, у питомцев сегодня видна разница', () => {
    const p = configPreview(early(), raise, '2026-11-02');
    expect(p).toMatchObject({ asOf: '2026-11-03', future: false, evaluatedDays: 1, evaluatedThrough: '2026-11-02', erased: [] });
    expect(p.changes[0]).toMatchObject({ group: 'СР1', before: { medkits: 1, toys: 1 }, after: { medkits: 0, toys: 0 } });
  });

  test('с даты после оценённых дней питомцы сегодня не меняются', () => {
    const p = configPreview(early(), raise, '2026-11-03');
    expect(p).toMatchObject({ future: false, evaluatedDays: 0, evaluatedThrough: null });
    expect(p.changes).toEqual([]);
  });

  test('дата в будущем: future, список пуст', () => {
    expect(configPreview(early(), raise, '2026-11-20')).toMatchObject({ future: true, changes: [], evaluatedDays: 0 });
  });

  test('воронка не загружена: оценённых дней нет', () => {
    expect(configPreview(early({ funnelThrough: null }), raise, '2026-11-02')).toMatchObject({ evaluatedDays: 0, evaluatedThrough: null });
  });

  test('на всю игру: оценённые дни считаются с начала игры, стираемые записи названы по датам', () => {
    const s = early({ configChanges: [{ from: '2026-11-09', config: { maxPiles: 2 } }, { from: '2026-11-12', config: { sickDaysNoPay: 3 } }] });
    expect(configPreview(s, { maxPiles: 6 })).toMatchObject({ future: false, evaluatedDays: 1, erased: ['2026-11-09'] });
    expect(configPreview(s, { boredomBelow: 0 }).erased).toEqual([]);
  });

  test('снимок не меняется', () => {
    const s = early({ configChanges: [{ from: '2026-11-09', config: { maxPiles: 2 } }] });
    const before = JSON.stringify(s);
    configPreview(s, raise, '2026-11-02');
    configPreview(s, { maxPiles: 6 });
    removalPreview(s, '2026-11-09');
    expect(JSON.stringify(s)).toBe(before);
  });

  test('снимок без поля configChanges (старый бэкенд) работает как с пустым списком', () => {
    const s = early();
    delete (s as Partial<Snapshot>).configChanges;
    expect(configPreview(s, raise, '2026-11-02').changes).toHaveLength(1);
  });
});

describe('removalPreview', () => {
  test('убирает запись из прошлого: питомцы сегодня возвращаются к нормам без неё', () => {
    const s = snap({
      serverNow: '2026-11-03T10:00:00+03:00',
      staff: [{ id: 'e1', name: 'Тест Иванов', shortName: 'Тест', group: 'СР1', hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [] }],
      funnelThrough: '2026-11-02',
      funnel: [{ employeeId: 'e1', date: '2026-11-02', quality: 5, long: 3 }],
      configChanges: [{ from: '2026-11-02', config: { norms: { experienced: { quality: 50, long: 50 } } } }],
    });
    const p = removalPreview(s, '2026-11-02');
    expect(p).toMatchObject({ future: false, evaluatedDays: 1 });
    expect(p.changes[0]).toMatchObject({ group: 'СР1', before: { medkits: 0, toys: 0 }, after: { medkits: 1, toys: 1 } });
  });

  test('запись из будущего: сегодня ничего не меняется', () => {
    const s = snap({ configChanges: [{ from: '2026-11-20', config: { maxPiles: 2 } }] });
    expect(removalPreview(s, '2026-11-20')).toMatchObject({ future: true, changes: [] });
  });
});

describe('describeEntry', () => {
  test('дата, затем поля в порядке формы: скаляры, потом нормы по уровням', () => {
    expect(describeEntry({ from: '2026-11-10', config: { norms: { rookie1: { long: 1 }, experienced: { quality: 2, long: 4 } }, maxPiles: 2, dailyNorm: 6 } }))
      .toBe('с 10.11.2026: Дневная норма оплат 6; Кучек (максимум) 2; Опытный — качественные 2, длинные 4; Новичок 1 — длинные 1');
  });
});

describe('describeChange', () => {
  const live =(stage: number, phase: 'pet' | 'egg0' = 'pet') => ({
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
