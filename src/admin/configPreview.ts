import { serverToday, type ConfigChange, type Snapshot, type SnapshotConfig } from '@/data/api';
import { configOf } from '@/data/config';
import { buildFacts } from '@/data/facts';
import { workingDaysBetween } from '@/engine/calendar';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import type { PetState } from '@/engine/pet';
import { LEVELS, LEVEL_TITLE, NORM_FIELD_TITLE, SCALAR_KEYS, SCALARS } from './configForm';
import { ruDate } from './dom';

export type PetLine = Pick<PetState, 'alive' | 'phase' | 'stage' | 'totalPayments' | 'medkits' | 'toys' | 'piles'>;
export interface GroupChange { group: GroupCode; before: PetLine; after: PetLine }

const lineOf = ({ alive, phase, stage, totalPayments, medkits, toys, piles }: PetState): PetLine => ({
  alive, phase, stage, totalPayments, medkits, toys, piles,
});

/** Так же, как `setConfig` на сервере: скаляры заменяются, нормы сливаются по уровню и полю, пороги стадий заменяются целиком. */
export function mergeConfig(raw: SnapshotConfig, patch: SnapshotConfig): SnapshotConfig {
  const out: SnapshotConfig = { ...raw, ...patch };
  if (patch.norms) {
    const norms: NonNullable<SnapshotConfig['norms']> = { ...raw.norms };
    for (const level of LEVELS) if (patch.norms[level]) norms[level] = { ...norms[level], ...patch.norms[level] };
    out.norms = norms;
  }
  return out;
}

/** То, что хранит сервер: настройки на всю игру и правки «с даты». */
export interface ConfigState { config: SnapshotConfig; configChanges: ConfigChange[] }

const stateOf = (s: Pick<Snapshot, 'config' | 'configChanges'>): ConfigState => ({
  config: s.config,
  configChanges: Array.isArray(s.configChanges) ? s.configChanges : [],
});

const byFrom = (a: ConfigChange, b: ConfigChange) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0);

/** Вычёркивает из записей поля патча (нормы — по уровню и полю); опустевшие записи удаляются, исходные не меняются. */
function stripFields(changes: ConfigChange[], patch: SnapshotConfig): ConfigChange[] {
  return changes
    .map((e) => {
      const config = structuredClone(e.config);
      for (const key of SCALAR_KEYS) if (key in patch) delete config[key];
      if (patch.norms && config.norms) {
        for (const level of LEVELS) {
          const fields = patch.norms[level];
          const norm = config.norms[level];
          if (!fields || !norm) continue;
          for (const f of ['quality', 'long'] as const) if (f in fields) delete norm[f];
          if (!Object.keys(norm).length) delete config.norms[level];
        }
        if (!Object.keys(config.norms).length) delete config.norms;
      }
      return { from: e.from, config };
    })
    .filter((e) => Object.keys(e.config).length > 0);
}

/**
 * Зеркало записи `setConfig` на сервере (apps-script/Code.gs): без даты правка идёт в настройки на всю игру и вычёркивает
 * те же поля из записей по датам; с датой — в запись этой даты (повтор сливается). Совпадение с сервером проверяет
 * apps-script/test/config-parity.test.mjs.
 */
export function applyPatch(state: ConfigState, patch: SnapshotConfig, from?: DateStr): ConfigState {
  if (from === undefined) {
    return { config: mergeConfig(state.config, patch), configChanges: stripFields(state.configChanges, patch) };
  }
  const existing = state.configChanges.find((e) => e.from === from);
  const entry: ConfigChange = { from, config: mergeConfig(existing?.config ?? {}, patch) };
  return { config: state.config, configChanges: [...state.configChanges.filter((e) => e.from !== from), entry].sort(byFrom) };
}

/** Зеркало `removeConfigChange`. */
export function removeChange(state: ConfigState, from: DateStr): ConfigState {
  return { config: state.config, configChanges: state.configChanges.filter((e) => e.from !== from) };
}

export interface ConfigPreview {
  /** «сегодня» по серверу (R23) */
  asOf: DateStr;
  /** правка с даты, которая ещё не наступила: сегодня ничего не меняется */
  future: boolean;
  /** рабочие дни от даты правки (без даты — с начала игры) до последнего дня с загруженной воронкой: у них пересчитывается оценка */
  evaluatedDays: number;
  evaluatedThrough: DateStr | null;
  changes: GroupChange[];
  /** даты записей, которые правка на всю игру урезает или убирает */
  erased: DateStr[];
}

function evaluated(s: Snapshot, from: DateStr, asOf: DateStr): { days: number; through: DateStr | null } {
  const end = s.funnelThrough === null ? null : s.funnelThrough < asOf ? s.funnelThrough : asOf;
  if (end === null || end < from) return { days: 0, through: null };
  const days = workingDaysBetween(from, end, configOf(s.config));
  return { days: days.length, through: days[days.length - 1] ?? null };
}

function compare(s: Snapshot, next: ConfigState, from: DateStr | undefined, erased: DateStr[]): ConfigPreview {
  const asOf = serverToday(s);
  const future = from !== undefined && from > asOf;
  const { days, through } = evaluated(s, from ?? configOf(s.config).startDate, asOf);
  const changes: GroupChange[] = [];
  if (!future) {
    const before = buildFacts(s, asOf).states;
    const after = buildFacts({ ...s, config: next.config, configChanges: next.configChanges }, asOf).states;
    for (const group of GROUPS) {
      const change = { group, before: lineOf(before[group]), after: lineOf(after[group]) };
      if (differences(change).length) changes.push(change);
    }
  }
  return { asOf, future, evaluatedDays: days, evaluatedThrough: through, changes, erased };
}

/**
 * Что станет с питомцами сегодня (по серверу, R23), если применить правку к нормам и порогам. Без даты правка действует
 * на всю историю, с датой — только с неё. В списке только группы, у которых что-то заметно изменилось.
 */
export function configPreview(s: Snapshot, patch: SnapshotConfig, from?: DateStr): ConfigPreview {
  const state = stateOf(s);
  const next = applyPatch(state, patch, from);
  const erased = from !== undefined ? [] : state.configChanges
    .filter((e) => JSON.stringify(next.configChanges.find((n) => n.from === e.from)?.config) !== JSON.stringify(e.config))
    .map((e) => e.from);
  return compare(s, next, from, erased);
}

/** То же для удаления записи «с даты». */
export function removalPreview(s: Snapshot, from: DateStr): ConfigPreview {
  return compare(s, removeChange(stateOf(s), from), from, []);
}

const looks = (l: PetLine): string => (!l.alive ? 'погиб' : l.phase === 'pet' ? `стадия ${l.stage}` : 'яйцо');

const COUNTS = [['medkits', 'аптечки'], ['toys', 'игрушки'], ['piles', 'кучки']] as const;

function differences({ before, after }: GroupChange): string[] {
  const parts: string[] = [];
  if (looks(before) !== looks(after)) parts.push(`${looks(before)} → ${looks(after)}`);
  for (const [key, title] of COUNTS) if (before[key] !== after[key]) parts.push(`${title} ${before[key]} → ${after[key]}`);
  return parts;
}

/** «СР1: стадия 7 → стадия 5; аптечки 3 → 1» — только то, что изменилось. */
export const describeChange = (c: GroupChange): string => `${c.group}: ${differences(c).join('; ')}`;

/** «с 10.11.2026: Кучек (максимум) 2; Опытный — качественные 2» — что задаёт запись. */
export function describeEntry({ from, config }: ConfigChange): string {
  const parts: string[] = [];
  for (const key of SCALAR_KEYS) if (config[key] !== undefined) parts.push(`${SCALARS[key]} ${config[key]}`);
  for (const level of LEVELS) {
    const norm = config.norms?.[level];
    if (!norm) continue;
    const fields = (['quality', 'long'] as const).filter((f) => norm[f] !== undefined).map((f) => `${NORM_FIELD_TITLE[f]} ${norm[f]}`);
    if (fields.length) parts.push(`${LEVEL_TITLE[level]} — ${fields.join(', ')}`);
  }
  return `с ${ruDate(from)}: ${parts.join('; ')}`;
}
