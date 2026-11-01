/** Куда смотрит камера: `overview` — общий план (кто-то работает с экраном), остальное — цикл на стене. */
export type Shot = 'overview' | 'rooms' | 'heroes' | 'group';

/** Цикл на стене: комнаты, доска героев, доска группы. */
export const CYCLE: readonly (readonly [Shot, number])[] = [['rooms', 25_000], ['heroes', 12_000], ['group', 18_000]];
/** Слайд правой доски (группа или «Топ-10») держится столько. */
export const SLIDE_MS = 6_000;

const CYCLE_MS = CYCLE.reduce((s, [, ms]) => s + ms, 0);
const SLIDES_PER_PASS = Math.floor((CYCLE.find(([s]) => s === 'group')?.[1] ?? 0) / SLIDE_MS);

/**
 * Кадр цикла через `ms` от его начала. `slide` — сквозной номер слайда правой доски: каждый проход
 * показывает следующие три, так что за несколько проходов видны все группы и «Топ-10».
 */
export function shotAt(ms: number): { shot: Shot; slide: number } {
  const t = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const pass = Math.floor(t / CYCLE_MS);
  const base = pass * SLIDES_PER_PASS;
  let rest = t - pass * CYCLE_MS;
  for (const [shot, len] of CYCLE) {
    if (rest < len) {
      return { shot, slide: shot === 'group' ? base + Math.min(Math.floor(rest / SLIDE_MS), SLIDES_PER_PASS - 1) : base };
    }
    rest -= len;
  }
  return { shot: CYCLE[0][0], slide: base };
}
