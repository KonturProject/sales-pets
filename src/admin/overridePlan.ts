import type { PetState } from '@/engine/pet';

export type OverrideKind = 'piles' | 'medkits' | 'toys';

/** Предел одной правки на сервере (`OVERRIDE_DELTA_MAX` в Code.gs). */
const DELTA_MAX = 20;

/** Дельта для `setOverride`: «выдать» — введённое число, «сбросить» — минус текущее число выбранного вида (0 — сбрасывать нечего). */
export function overrideDelta(kind: OverrideKind, mode: 'give' | 'reset', amount: number, state: PetState): number {
  return mode === 'give' ? amount : -state[kind] || 0;
}

export function parseAmount(text: string): number | { error: string } {
  const n = /^\d+$/.test(text.trim()) ? Number(text.trim()) : 0;
  return n >= 1 && n <= DELTA_MAX ? n : { error: `Количество — целое число от 1 до ${DELTA_MAX}` };
}

/** Одна правка на сервере не больше 20 по модулю: большой сброс уходит несколькими. */
export function splitDelta(delta: number): number[] {
  const sign = Math.sign(delta);
  const parts: number[] = [];
  for (let left = Math.abs(delta); left > 0; left -= DELTA_MAX) parts.push(sign * Math.min(left, DELTA_MAX));
  return parts;
}
