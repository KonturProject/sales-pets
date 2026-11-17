import type { SnapshotOverride } from '@/data/api';
import type { PetState } from '@/engine/pet';
import type { DateStr, GroupCode } from '@/engine/types';

export type ToyKind =
  | 'bear' | 'duck' | 'top' | 'cube' | 'hedgehog'
  | 'balloon' | 'yoyo' | 'plane' | 'car' | 'bubbles' | 'drum' | 'phone' | 'bouncer' | 'rocket' | 'dumbbell';
/**
 * Как питомец играет: обнимает, пинает с прыжком игрушки, крутит на месте, катит как мяч; у десяти новых игрушек —
 * трюки (`toyTricks.ts`): шарик на ниточке, йо-йо, бросок самолётика, заводная машинка, пузыри, барабан, телефон,
 * попрыгунчик, запуск ракеты, гантелька.
 */
export type ToyPlay =
  | 'hug' | 'bounce' | 'spin' | 'roll'
  | 'float' | 'yoyo' | 'glide' | 'drive' | 'bubbles' | 'drum' | 'call' | 'hop' | 'launch' | 'lift';

export const TOYS: readonly { kind: ToyKind; play: ToyPlay }[] = [
  { kind: 'bear', play: 'hug' },
  { kind: 'duck', play: 'bounce' },
  { kind: 'top', play: 'spin' },
  { kind: 'cube', play: 'roll' },
  { kind: 'hedgehog', play: 'roll' },
  { kind: 'balloon', play: 'float' },
  { kind: 'yoyo', play: 'yoyo' },
  { kind: 'plane', play: 'glide' },
  { kind: 'car', play: 'drive' },
  { kind: 'bubbles', play: 'bubbles' },
  { kind: 'drum', play: 'drum' },
  { kind: 'phone', play: 'call' },
  { kind: 'bouncer', play: 'hop' },
  { kind: 'rocket', play: 'launch' },
  { kind: 'dumbbell', play: 'lift' },
];

/** Высота рамки картинки в комнате, px (`--toy-h`, низ на полу): шарик с ниточкой, баночка и ракета выше обычных 56, йо-йо меньше. */
const TOY_H: Partial<Record<ToyKind, number>> = { balloon: 84, bubbles: 66, rocket: 70, yoyo: 40 };
export const toyHeight = (kind: ToyKind): number => TOY_H[kind] ?? 56;

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
