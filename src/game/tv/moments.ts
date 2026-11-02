import { THEME } from '@/art/manifest';
import type { Mood, PetState } from '@/engine/pet';
import { GROUPS, type GroupCode } from '@/engine/types';
import { MAX_STAGE } from '@/game/PetView';

/** Повод показать комнату крупным планом: группа и текст плашки. */
export interface RoomMoment {
  group: GroupCode;
  text: string;
}

/** Больше показов за одно обновление не бывает: массовый импорт не должен держать камеру минутами. */
export const MAX_MOMENTS = 3;

/**
 * Вылупление и рост стадии между прошлым и новым обновлением. Без прошлого (загрузка экрана) — ничего;
 * понижение стадии, гибель и новое яйцо поводом не считаются.
 */
export function growthMoments(prev: Record<GroupCode, PetState> | null, now: Record<GroupCode, PetState>): RoomMoment[] {
  if (!prev) return [];
  const out: RoomMoment[] = [];
  for (const g of GROUPS) {
    const a = prev[g];
    const b = now[g];
    if (!a || !b || !b.alive || b.phase !== 'pet' || b.generation !== a.generation) continue;
    if (a.phase !== 'pet') out.push({ group: g, text: `${g}: вылупился ${THEME[g].species}!` });
    else if (b.stage > a.stage) out.push({ group: g, text: `Питомец ${g} подрос: стадия ${b.stage} из ${MAX_STAGE}` });
  }
  return out.slice(0, MAX_MOMENTS);
}

const NEED: Partial<Record<Mood, string>> = { sick: 'болеет — нужна аптечка', sad: 'грустит — нужна игрушка', bored: 'скучает — нужна игрушка' };

/** Питомцы, которым нужна помощь РГ: сначала больные, потом грустные и скучающие (порядок групп как на экране). */
export function careRooms(states: Record<GroupCode, PetState>): RoomMoment[] {
  const need = GROUPS.filter((g) => states[g]?.alive && states[g].phase === 'pet' && NEED[states[g].mood]);
  const sick = need.filter((g) => states[g].mood === 'sick');
  return [...sick, ...need.filter((g) => states[g].mood !== 'sick')].map((g) => ({ group: g, text: `Питомец ${g} ${NEED[states[g].mood]}` }));
}
