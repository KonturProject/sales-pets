import { defaultConfig, type Config } from '@/engine/config';
import type { Level } from '@/engine/types';
import type { SnapshotConfig } from './api';

// Диапазоны те же, что у setConfig в apps-script/Code.gs: ячейку листа могли испортить руками (R17)
const INT_RANGES = {
  maxPiles: [1, 20],
  boredomBelow: [0, 100],
  sickDaysNoPay: [1, 30],
  sickPilesAbove: [0, 20],
  deathDaysNoPay: [1, 30],
} as const;
const DAILY_NORM_RANGE = [1, 1000] as const;
const NORM_MAX = 50;
const STAGE_COUNT = 15;
const STAGE_THRESHOLD_MAX = 100_000;
const LEVELS = Object.keys(defaultConfig.norms) as Level[];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIntIn = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

const validThresholds = (v: unknown): v is number[] =>
  Array.isArray(v) &&
  v.length === STAGE_COUNT &&
  v.every((t, i) => isIntIn(t, 1, STAGE_THRESHOLD_MAX) && (i === 0 || t > (v[i - 1] as number)));

const cache = new WeakMap<object, Config>();

/**
 * Настройки игры из снимка поверх `defaultConfig`: каждое поле проверяется отдельно, негодное молча заменяется умолчанием.
 * Для одного и того же объекта результат один и тот же (от этого зависит кэш `buildFacts`); для `{}` это сам `defaultConfig`.
 */
export function configOf(raw: SnapshotConfig): Config {
  if (!isObject(raw)) return defaultConfig;
  const hit = cache.get(raw);
  if (hit) return hit;
  const cfg = parse(raw);
  cache.set(raw, cfg);
  return cfg;
}

function parse(raw: Record<string, unknown>): Config {
  let changed = false;
  const out: Config = {
    ...defaultConfig,
    norms: Object.fromEntries(LEVELS.map((l) => [l, { ...defaultConfig.norms[l] }])) as Config['norms'],
  };

  for (const key of Object.keys(INT_RANGES) as (keyof typeof INT_RANGES)[]) {
    const [lo, hi] = INT_RANGES[key];
    if (isIntIn(raw[key], lo, hi)) { out[key] = raw[key]; changed = true; }
  }

  if (isObject(raw.norms)) {
    for (const level of LEVELS) {
      const norm = raw.norms[level];
      if (!isObject(norm)) continue;
      for (const field of ['quality', 'long'] as const) {
        if (isIntIn(norm[field], 0, NORM_MAX)) { out.norms[level][field] = norm[field]; changed = true; }
      }
    }
  }

  if (validThresholds(raw.stageThresholds)) { out.stageThresholds = [...raw.stageThresholds]; changed = true; }

  return changed ? out : defaultConfig;
}

/** Дневная норма оплат из снимка, если она годная; иначе `undefined` — вызывающий берёт умолчание. */
export function dailyNormOf(raw: SnapshotConfig): number | undefined {
  return isObject(raw) && isIntIn(raw.dailyNorm, ...DAILY_NORM_RANGE) ? raw.dailyNorm : undefined;
}
