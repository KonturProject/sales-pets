/** Куда смотрит камера: `overview` — общий план (праздник, первый кадр), остальное — цикл камеры. */
export type Shot = 'overview' | 'rooms' | 'heroes' | 'group' | 'walk';

/** Прогулка в зале: столько длится кадр `walk`. */
export const WALK_MS = 30_000;
/** Цикл камеры: комнаты, доска героев, доска группы, прогулка (домой питомцы возвращаются под переход на комнаты). */
export const CYCLE: readonly (readonly [Shot, number])[] = [['rooms', 25_000], ['heroes', 12_000], ['group', 18_000], ['walk', WALK_MS]];
/** Прогулка короче этого не начинается: кадр «прогулка» застали под конец (кончилось удержание доски) — сразу комнаты. */
export const MIN_WALK_MS = 12_000;

/**
 * Сколько гулять, если кадр «прогулка» застали через `at` мс от его начала: остаток кадра без секунды на переход,
 * чтобы питомцы дошли домой до смены кадра; 0 — уже не начинать.
 */
export function walkFor(at: number): number {
  const left = WALK_MS - at;
  return left >= MIN_WALK_MS ? left - 1_000 : 0;
}
/** Слайд правой доски (группа или «Топ-10») держится столько. */
export const SLIDE_MS = 6_000;

const CYCLE_MS = CYCLE.reduce((s, [, ms]) => s + ms, 0);
const SLIDES_PER_PASS = Math.floor((CYCLE.find(([s]) => s === 'group')?.[1] ?? 0) / SLIDE_MS);

/**
 * Кадр цикла через `ms` от его начала. `slide` — сквозной номер слайда правой доски: каждый проход
 * показывает следующие три, так что за несколько проходов видны все группы и «Топ-10». `at` — мс внутри кадра.
 */
export function shotAt(ms: number): { shot: Shot; slide: number; at: number } {
  const t = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const pass = Math.floor(t / CYCLE_MS);
  const base = pass * SLIDES_PER_PASS;
  let rest = t - pass * CYCLE_MS;
  for (const [shot, len] of CYCLE) {
    if (rest < len) {
      return { shot, slide: shot === 'group' ? base + Math.min(Math.floor(rest / SLIDE_MS), SLIDES_PER_PASS - 1) : base, at: rest };
    }
    rest -= len;
  }
  return { shot: CYCLE[0][0], slide: base, at: 0 };
}
