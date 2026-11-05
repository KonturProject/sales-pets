import type { SnapshotOverride } from '@/data/api';
import type { PetState } from '@/engine/pet';
import type { DateStr, GroupCode } from '@/engine/types';

export type ToyKind = 'bear' | 'duck' | 'top' | 'cube' | 'hedgehog';
/** Как питомец играет: обнимает, пинает с прыжком игрушки, крутит на месте, катит как мяч. */
export type ToyPlay = 'hug' | 'bounce' | 'spin' | 'roll';

export const TOYS: readonly { kind: ToyKind; play: ToyPlay }[] = [
  { kind: 'bear', play: 'hug' },
  { kind: 'duck', play: 'bounce' },
  { kind: 'top', play: 'spin' },
  { kind: 'cube', play: 'roll' },
  { kind: 'hedgehog', play: 'roll' },
];

/** Игрушка по `id` расхода: на всех ТВ и после перезагрузки одна и та же. */
export function toyKindFor(useId: number): ToyKind {
  return TOYS[useId % TOYS.length]!.kind;
}

/** Игрушка дня группы: последний по `id` расход игрушки с датой `today` (сервера); нет расхода — `null`. */
export function toyOfDay(overrides: SnapshotOverride[], group: GroupCode, today: DateStr): { id: number; kind: ToyKind } | null {
  let last: SnapshotOverride | null = null;
  for (const o of overrides) {
    if (o.kind === 'useToy' && o.group === group && o.date === today && (!last || o.id > last.id)) last = o;
  }
  return last ? { id: last.id, kind: toyKindFor(last.id) } : null;
}

/** Игрушка в комнате: только у живого вылупившегося питомца. */
export function toyForRoom(toy: ReturnType<typeof toyOfDay>, s: PetState): ToyKind | null {
  return toy && s.alive && s.phase === 'pet' ? toy.kind : null;
}
