import { defaultConfig, type Config } from '@/engine/config';
import type { DateStr, Level } from '@/engine/types';
import type { ConfigChange, Snapshot, SnapshotConfig } from './api';

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

const cloneConfig = (c: Config): Config => ({
  ...c,
  norms: Object.fromEntries(LEVELS.map((l) => [l, { ...c.norms[l] }])) as Config['norms'],
});

/** Переносит из `raw` в `out` годные поля (негодное пропускается); `true`, если что-то перенесено. Пороги стадий — только если разрешены. */
function applyValid(out: Config, raw: Record<string, unknown>, withThresholds: boolean): boolean {
  let changed = false;

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

  if (withThresholds && validThresholds(raw.stageThresholds)) { out.stageThresholds = [...raw.stageThresholds]; changed = true; }

  return changed;
}

function parse(raw: Record<string, unknown>): Config {
  const out = cloneConfig(defaultConfig);
  return applyValid(out, raw, true) ? out : defaultConfig;
}

/** Дневная норма оплат из снимка, если она годная; иначе `undefined` — вызывающий берёт умолчание. */
export function dailyNormOf(raw: SnapshotConfig): number | undefined {
  return isObject(raw) && isIntIn(raw.dailyNorm, ...DAILY_NORM_RANGE) ? raw.dailyNorm : undefined;
}

/** Настройки игры по датам: база («вся игра») и правки, действующие с даты. Пороги стадий от даты не зависят. */
export interface Timeline {
  at(date: DateStr): Config;
  dailyNormAt(date: DateStr): number | undefined;
}

const timelines = new WeakMap<object, Timeline>();
const isDateStr = (v: unknown): v is DateStr => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Цепочка настроек снимка: значение на день D — база, поверх неё по порядку правки с `from ≤ D`. Негодные записи и поля
 * пропускаются (поле правки наследует прежнее значение), цепочка считается один раз на объект снимка (R37).
 */
export function timelineOf(s: Pick<Snapshot, 'config' | 'configChanges'>): Timeline {
  const hit = timelines.get(s);
  if (hit) return hit;

  const base = configOf(s.config);
  const baseNorm = dailyNormOf(s.config);
  const entries = (Array.isArray(s.configChanges) ? s.configChanges : [])
    .filter((e): e is ConfigChange => isObject(e) && isDateStr(e.from) && isObject(e.config))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  let cfg = base;
  let norm = baseNorm;
  const steps = entries.map((e) => {
    const next = cloneConfig(cfg);
    applyValid(next, e.config as Record<string, unknown>, false);
    cfg = next;
    if (isIntIn(e.config.dailyNorm, ...DAILY_NORM_RANGE)) norm = e.config.dailyNorm;
    return { from: e.from, cfg, norm };
  });
  const last = (date: DateStr) => {
    let found: (typeof steps)[number] | undefined;
    for (const step of steps) {
      if (step.from > date) break;
      found = step;
    }
    return found;
  };

  const timeline: Timeline = {
    at: (date) => last(date)?.cfg ?? base,
    dailyNormAt: (date) => (last(date) ? last(date)!.norm : baseNorm),
  };
  timelines.set(s, timeline);
  return timeline;
}
