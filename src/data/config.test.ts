import { describe, expect, test } from 'vitest';
import { defaultConfig } from '@/engine/config';
import { configOf, timelineOf } from './config';
import type { ConfigChange, Snapshot, SnapshotConfig } from './api';

/** Минимальный снимок: конфиг и записи по датам; `changes` может быть чем угодно (у старого бэкенда поля нет). */
const tl = (config: SnapshotConfig, changes?: unknown) =>
  timelineOf({ config, configChanges: changes } as Pick<Snapshot, 'config' | 'configChanges'>);
const change = (from: string, config: SnapshotConfig): ConfigChange => ({ from, config });

describe('configOf', () => {
  test('пустой config — умолчания движка (тот же объект)', () => {
    expect(configOf({})).toBe(defaultConfig);
  });

  test('частичная правка меняет только своё поле', () => {
    expect(configOf({ maxPiles: 7 })).toEqual({ ...defaultConfig, maxPiles: 7 });
    expect(configOf({ boredomBelow: 0, sickDaysNoPay: 3 })).toEqual({ ...defaultConfig, boredomBelow: 0, sickDaysNoPay: 3 });
  });

  test('нормы сливаются по уровням и по полям: нетронутое остаётся умолчанием', () => {
    const cfg = configOf({ norms: { rookie1: { quality: 3 }, experienced: { long: 0 } } });
    expect(cfg.norms).toEqual({
      experienced: { quality: 5, long: 0 },
      rookie1: { quality: 3, long: 0 },
      rookie2: { quality: 2, long: 1 },
    });
  });

  test('пороги стадий: ровно 15 строго возрастающих — принимаются', () => {
    const thresholds = Array.from({ length: 15 }, (_, i) => (i + 1) * 5);
    expect(configOf({ stageThresholds: thresholds }).stageThresholds).toEqual(thresholds);
  });

  test('календарь не берётся из config, даже если он там есть', () => {
    const raw = { startDate: '2020-01-01', endDate: '2020-02-01', nonWorking: [] } as unknown as SnapshotConfig;
    expect(configOf(raw)).toBe(defaultConfig);
  });

  test('испорченное значение игнорируется по полю, годное рядом остаётся', () => {
    const bad = [
      { stageThresholds: Array.from({ length: 14 }, (_, i) => i + 1) },
      { stageThresholds: [6, 10, 10, ...defaultConfig.stageThresholds.slice(3)] },
      { stageThresholds: 'x' },
      { maxPiles: -1 },
      { maxPiles: 21 },
      { maxPiles: 2.5 },
      { maxPiles: '5' },
      { boredomBelow: NaN },
      { dailyNorm: 0 },
      { norms: { experienced: { quality: 'x' } } },
      { norms: { experienced: { quality: 51 } } },
      { norms: { unknown: { quality: 1 } } },
      { norms: 'x' },
    ] as unknown as SnapshotConfig[];
    for (const raw of bad) {
      expect(configOf({ ...raw, sickPilesAbove: 3 })).toEqual({ ...defaultConfig, sickPilesAbove: 3 });
    }
  });

  test('одно испорченное поле нормы не отбрасывает исправное в том же уровне', () => {
    const raw = { norms: { experienced: { quality: 'x', long: 2 } } } as unknown as SnapshotConfig;
    expect(configOf(raw).norms.experienced).toEqual({ quality: 5, long: 2 });
  });

  test('не объект (null, число, строка, массив) — умолчания', () => {
    for (const raw of [null, 5, 'x', []] as unknown as SnapshotConfig[]) {
      expect(configOf(raw)).toBe(defaultConfig);
    }
  });

  test('один и тот же объект даёт один и тот же результат', () => {
    const raw: SnapshotConfig = { maxPiles: 7 };
    expect(configOf(raw)).toBe(configOf(raw));
    expect(configOf({ maxPiles: 7 })).not.toBe(configOf(raw));
  });

  test('умолчания не изменяются разбором', () => {
    const before = JSON.stringify(defaultConfig);
    configOf({ maxPiles: 7, norms: { rookie1: { quality: 9 } }, stageThresholds: Array.from({ length: 15 }, (_, i) => i + 1) });
    expect(JSON.stringify(defaultConfig)).toBe(before);
  });
});

describe('timelineOf', () => {
  test('без записей на любую дату — тот же объект, что configOf(config)', () => {
    const raw: SnapshotConfig = { maxPiles: 7 };
    expect(tl(raw, []).at('2026-11-02')).toBe(configOf(raw));
    expect(tl(raw, []).at('2026-11-20')).toBe(configOf(raw));
    expect(tl({}, []).at('2026-11-12')).toBe(defaultConfig);
  });

  test('старый бэкенд без поля configChanges (и не массив) — как пустой список', () => {
    expect(tl({ maxPiles: 7 }, undefined).at('2026-11-12')).toEqual({ ...defaultConfig, maxPiles: 7 });
    expect(tl({ maxPiles: 7 }, 'x').at('2026-11-12')).toEqual({ ...defaultConfig, maxPiles: 7 });
  });

  test('запись меняет нормы с своей даты: до даты база, с даты — новое значение, нетронутое остаётся', () => {
    const t = tl({}, [change('2026-11-09', { norms: { experienced: { quality: 2 } } })]);
    expect(t.at('2026-11-06').norms.experienced).toEqual({ quality: 5, long: 3 });
    expect(t.at('2026-11-09').norms.experienced).toEqual({ quality: 2, long: 3 });
    expect(t.at('2026-11-20').norms.experienced).toEqual({ quality: 2, long: 3 });
    expect(t.at('2026-11-09').maxPiles).toBe(defaultConfig.maxPiles);
  });

  test('запись наследует базу и предыдущие записи', () => {
    const t = tl({ maxPiles: 7 }, [change('2026-11-09', { boredomBelow: 0 }), change('2026-11-12', { norms: { experienced: { quality: 1 } } })]);
    expect(t.at('2026-11-09')).toMatchObject({ maxPiles: 7, boredomBelow: 0 });
    expect(t.at('2026-11-10').norms.experienced.quality).toBe(5);
    expect(t.at('2026-11-12')).toMatchObject({ maxPiles: 7, boredomBelow: 0 });
    expect(t.at('2026-11-12').norms.experienced.quality).toBe(1);
  });

  test('пороги стадий в записи по дате игнорируются', () => {
    const t = tl({}, [change('2026-11-09', { maxPiles: 2, stageThresholds: Array.from({ length: 15 }, (_, i) => i + 1) })]);
    expect(t.at('2026-11-10').stageThresholds).toEqual(defaultConfig.stageThresholds);
    expect(t.at('2026-11-10').maxPiles).toBe(2);
  });

  test('мусор пропускается, годное рядом остаётся', () => {
    const t = tl({}, [
      null,
      change('x', { maxPiles: 3 }),
      { from: '2026-11-09', config: null },
      change('2026-11-09', { maxPiles: -1, sickPilesAbove: 3 }),
    ]);
    expect(t.at('2026-11-10')).toEqual({ ...defaultConfig, sickPilesAbove: 3 });
  });

  test('записи в любом порядке упорядочиваются по дате', () => {
    const t = tl({}, [change('2026-11-12', { maxPiles: 3 }), change('2026-11-09', { maxPiles: 2 })]);
    expect(t.at('2026-11-10').maxPiles).toBe(2);
    expect(t.at('2026-11-12').maxPiles).toBe(3);
  });

  test('даты с одним набором записей дают один и тот же объект', () => {
    const t = tl({}, [change('2026-11-09', { maxPiles: 2 })]);
    expect(t.at('2026-11-10')).toBe(t.at('2026-11-11'));
    expect(t.at('2026-11-10')).not.toBe(t.at('2026-11-06'));
  });

  test('разбор не меняет умолчания', () => {
    const before = JSON.stringify(defaultConfig);
    tl({}, [change('2026-11-09', { maxPiles: 2, norms: { rookie1: { quality: 9 } } })]).at('2026-11-10');
    expect(JSON.stringify(defaultConfig)).toBe(before);
  });

  test('dailyNormAt: база, затем записи; испорченное значение оставляет унаследованное', () => {
    const t = tl({ dailyNorm: 6 }, [change('2026-11-09', { dailyNorm: 8 }), change('2026-11-12', { dailyNorm: 0 })]);
    expect(t.dailyNormAt('2026-11-06')).toBe(6);
    expect(t.dailyNormAt('2026-11-09')).toBe(8);
    expect(t.dailyNormAt('2026-11-12')).toBe(8);
    expect(tl({}, []).dailyNormAt('2026-11-12')).toBeUndefined();
  });

  test('один и тот же снимок — один и тот же Timeline', () => {
    const s = { config: {}, configChanges: [] } as Pick<Snapshot, 'config' | 'configChanges'>;
    expect(timelineOf(s)).toBe(timelineOf(s));
    expect(timelineOf({ ...s })).not.toBe(timelineOf(s));
  });
});
