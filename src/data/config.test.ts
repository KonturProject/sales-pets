import { describe, expect, test } from 'vitest';
import { defaultConfig } from '@/engine/config';
import { configOf } from './config';
import type { SnapshotConfig } from './api';

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
