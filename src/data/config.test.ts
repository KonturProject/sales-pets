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
      experienced: { quality: 5, long: 0, payments: 0.4 },
      rookie1: { quality: 3, long: 0, payments: 0 },
      rookie2: { quality: 2, long: 1, payments: 0.2 },
    });
  });

  test('норма оплат в день — дробная, до двух знаков', () => {
    for (const payments of [0, 0.29, 0.57, 1.15, 50]) {
      expect(configOf({ norms: { experienced: { payments } } }).norms.experienced.payments).toBe(payments);
    }
  });

  test('пороги стадий 2–5: ровно 4 строго возрастающих процента до 1000 — принимаются', () => {
    for (const thresholds of [[10, 30, 50, 70], [50, 100, 200, 1000]]) {
      expect(configOf({ stageThresholds: thresholds }).stageThresholds).toEqual(thresholds);
    }
  });

  test('даты игры не берутся из config, даже если они там есть', () => {
    const raw = { startDate: '2020-01-01', endDate: '2020-02-01' } as unknown as SnapshotConfig;
    expect(configOf(raw)).toBe(defaultConfig);
    const withDays = { startDate: '2020-01-01', endDate: '2020-02-01', nonWorking: ['2026-11-05'] } as unknown as SnapshotConfig;
    expect(configOf(withDays)).toEqual({ ...defaultConfig, nonWorking: ['2026-11-05'] });
  });

  test('качественные и длинные — дробные, до двух знаков, 0…50', () => {
    expect(configOf({ norms: { experienced: { long: 1.5 } } }).norms.experienced).toEqual({ quality: 5, long: 1.5, payments: 0.4 });
    for (const field of ['quality', 'long'] as const) {
      for (const v of [0, 0.01, 0.25, 1.15, 50]) {
        expect(configOf({ norms: { rookie1: { [field]: v } } }).norms.rookie1[field]).toBe(v);
      }
    }
  });

  test('качественные и длинные: больше двух знаков, отрицательные и выше 50 — норма по умолчанию', () => {
    for (const field of ['quality', 'long'] as const) {
      for (const v of [1.555, 0.001, -0.5, 50.01, NaN, '1.5']) {
        const raw = { sickPilesAbove: 3, norms: { experienced: { [field]: v } } } as unknown as SnapshotConfig;
        expect(configOf(raw), `${field} ${String(v)}`).toEqual({ ...defaultConfig, sickPilesAbove: 3 });
      }
    }
  });

  test('выходные: список сортируется, сырой объект не меняется', () => {
    const nonWorking = ['2026-11-05', '2026-11-04'];
    expect(configOf({ nonWorking }).nonWorking).toEqual(['2026-11-04', '2026-11-05']);
    expect(nonWorking).toEqual(['2026-11-05', '2026-11-04']);
  });

  test('выходные: пустой список — «выходных нет», а не умолчание', () => {
    expect(configOf({ nonWorking: [] }).nonWorking).toEqual([]);
    expect(defaultConfig.nonWorking).not.toEqual([]);
  });

  test('выходные: весь период (21 день) принимается', () => {
    const all = Array.from({ length: 21 }, (_, i) => `2026-11-${String(i + 2).padStart(2, '0')}`);
    expect(all[0]).toBe('2026-11-02');
    expect(all[20]).toBe('2026-11-22');
    expect(configOf({ nonWorking: all }).nonWorking).toEqual(all);
  });

  test('выходные: негодный список целиком заменяется встроенным календарём, годное рядом остаётся', () => {
    const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;
    const bad = [
      ['x'],
      ['2026-11-31'],
      ['2026-11-30'],
      ['2026-11-01'],
      ['2026-11-23'],
      ['2026-11-05', '2026-11-05'],
      ['2026-11-05', 'x'],
      [20261105],
      [null],
      'x',
      null,
      { 0: '2026-11-05' },
      // 22 даты: период игры вмещает 21 день, поэтому лишняя может быть только повтором
      [...Array.from({ length: 21 }, (_, i) => day(i + 2)), day(5)],
    ] as unknown[];
    for (const nonWorking of bad) {
      const raw = { nonWorking, sickPilesAbove: 3 } as unknown as SnapshotConfig;
      expect(configOf(raw), JSON.stringify(nonWorking)).toEqual({ ...defaultConfig, sickPilesAbove: 3 });
    }
  });

  test('испорченное значение игнорируется по полю, годное рядом остаётся', () => {
    const bad = [
      { stageThresholds: [6, 10, 15, 21, 28, 36, 45, 55, 66, 78, 91, 105, 120, 136, 153] },
      { stageThresholds: [25, 50, 75] },
      { stageThresholds: [25, 50, 50, 100] },
      { stageThresholds: [25, 50, 75, 1001] },
      { stageThresholds: 'x' },
      { maxPiles: -1 },
      { maxPiles: 21 },
      { maxPiles: 2.5 },
      { maxPiles: '5' },
      { boredomBelow: NaN },
      { norms: { experienced: { quality: 'x' } } },
      { norms: { experienced: { payments: 0.123 } } },
      { norms: { experienced: { payments: NaN } } },
      { norms: { experienced: { payments: '0.4' } } },
      { norms: { experienced: { payments: -0.1 } } },
      { norms: { experienced: { payments: 50.01 } } },
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
    expect(configOf(raw).norms.experienced).toEqual({ quality: 5, long: 2, payments: 0.4 });
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
    configOf({ maxPiles: 7, norms: { rookie1: { quality: 9, payments: 1 } }, stageThresholds: [1, 2, 3, 4] });
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
    expect(t.at('2026-11-06').norms.experienced).toEqual({ quality: 5, long: 3, payments: 0.4 });
    expect(t.at('2026-11-09').norms.experienced).toEqual({ quality: 2, long: 3, payments: 0.4 });
    expect(t.at('2026-11-20').norms.experienced).toEqual({ quality: 2, long: 3, payments: 0.4 });
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
    const t = tl({}, [change('2026-11-09', { maxPiles: 2, stageThresholds: [1, 2, 3, 4] })]);
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

  test('норма оплат «с даты»: до даты база, с даты новая; испорченная оставляет унаследованную', () => {
    const t = tl({ norms: { experienced: { payments: 0.6 } } }, [
      change('2026-11-09', { norms: { experienced: { payments: 0.8 } } }),
      change('2026-11-12', { norms: { experienced: { payments: 0.123 } } }),
    ]);
    expect(t.at('2026-11-06').norms.experienced.payments).toBe(0.6);
    expect(t.at('2026-11-09').norms.experienced.payments).toBe(0.8);
    expect(t.at('2026-11-12').norms.experienced.payments).toBe(0.8);
  });

  test('запись «с даты» календарь не меняет: выходные берутся только из базы', () => {
    const base = tl({ nonWorking: ['2026-11-05'] }, [change('2026-11-09', { nonWorking: ['2026-11-10'], maxPiles: 2 })]);
    expect(base.at('2026-11-06').nonWorking).toEqual(['2026-11-05']);
    expect(base.at('2026-11-10').nonWorking).toEqual(['2026-11-05']);
    expect(base.at('2026-11-10').maxPiles).toBe(2);
    const onlyEntry = tl({}, [change('2026-11-09', { nonWorking: [] })]);
    expect(onlyEntry.at('2026-11-10').nonWorking).toEqual(defaultConfig.nonWorking);
  });

  test('дробные нормы «с даты»: принимаются, испорченные оставляют унаследованное', () => {
    const t = tl({}, [
      change('2026-11-09', { norms: { experienced: { long: 1.5 } } }),
      change('2026-11-12', { norms: { experienced: { long: 1.555, quality: 0.25 } } }),
    ]);
    expect(t.at('2026-11-09').norms.experienced.long).toBe(1.5);
    expect(t.at('2026-11-12').norms.experienced).toEqual({ quality: 0.25, long: 1.5, payments: 0.4 });
  });

  test('один и тот же снимок — один и тот же Timeline', () => {
    const s = { config: {}, configChanges: [] } as Pick<Snapshot, 'config' | 'configChanges'>;
    expect(timelineOf(s)).toBe(timelineOf(s));
    expect(timelineOf({ ...s })).not.toBe(timelineOf(s));
  });
});
