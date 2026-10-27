import { serverToday, type Snapshot, type SnapshotConfig } from '@/data/api';
import { buildFacts } from '@/data/facts';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import type { PetState } from '@/engine/pet';
import { LEVELS } from './configForm';

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

/**
 * Что станет с питомцами сегодня (по серверу, R23), если применить правку к нормам и порогам: правка действует на всю историю,
 * поэтому считаем те же факты с новыми настройками. В списке только группы, у которых что-то заметно изменилось.
 */
export function configPreview(s: Snapshot, patch: SnapshotConfig): { asOf: DateStr; changes: GroupChange[] } {
  const asOf = serverToday(s);
  const before = buildFacts(s, asOf).states;
  const after = buildFacts({ ...s, config: mergeConfig(s.config, patch) }, asOf).states;
  const changes: GroupChange[] = [];
  for (const group of GROUPS) {
    const b = before[group];
    const a = after[group];
    const change = { group, before: lineOf(b), after: lineOf(a) };
    if (differences(change).length) changes.push(change);
  }
  return { asOf, changes };
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
