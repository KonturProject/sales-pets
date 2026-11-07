/** Куда смотрит камера: `overview` — общий план (праздник, первый кадр), остальное — цикл камеры. */
export type Shot = 'overview' | 'rooms' | 'heroes' | 'group' | 'walk';

/** Один круг камеры: комнаты, доска героев, доска группы. */
export const PASS: readonly (readonly [Shot, number])[] = [['rooms', 25_000], ['heroes', 12_000], ['group', 18_000]];
/** Столько кругов подряд, потом прогулка: она раз в ~5 минут. */
export const PASSES_PER_WALK = 4;
/** Прогулка в зале: столько длится кадр `walk` (домой питомцы возвращаются под переход на комнаты). */
export const WALK_MS = 80_000;
/**
 * Прогулка короче этого не начинается: кадр «прогулка» застали под конец (кончилось удержание доски) — сразу комнаты.
 * Самая короткая — выход (~7 с), немного побродить и 8 с на дорогу домой (`HOME_MS` в Hall).
 */
export const MIN_WALK_MS = 18_000;

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

const PASS_MS = PASS.reduce((s, [, ms]) => s + ms, 0);
/** Цикл камеры: четыре круга и прогулка. */
export const CYCLE_MS = PASSES_PER_WALK * PASS_MS + WALK_MS;
const SLIDES_PER_PASS = Math.floor((PASS.find(([s]) => s === 'group')?.[1] ?? 0) / SLIDE_MS);

/**
 * Кадр цикла через `ms` от его начала. `slide` — сквозной номер слайда правой доски: каждый круг
 * показывает следующие три, так что за несколько кругов видны все группы и «Топ-10». `at` — мс внутри кадра.
 */
export function shotAt(ms: number): { shot: Shot; slide: number; at: number } {
  const t = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const cycle = Math.floor(t / CYCLE_MS);
  let rest = t - cycle * CYCLE_MS;
  const lap = Math.min(Math.floor(rest / PASS_MS), PASSES_PER_WALK);
  const base = (cycle * PASSES_PER_WALK + Math.min(lap, PASSES_PER_WALK - 1)) * SLIDES_PER_PASS;
  rest -= lap * PASS_MS;
  if (lap === PASSES_PER_WALK) return { shot: 'walk', slide: base, at: rest };
  for (const [shot, len] of PASS) {
    if (rest < len) {
      return { shot, slide: shot === 'group' ? base + Math.min(Math.floor(rest / SLIDE_MS), SLIDES_PER_PASS - 1) : base, at: rest };
    }
    rest -= len;
  }
  return { shot: PASS[0][0], slide: base, at: 0 };
}

/** Кадр «комнаты»: столько общий план, дальше визиты к тем, кому нужна помощь, по `CARE_MS`. */
const CARE_FROM = 12_000;
const CARE_MS = 6_500;
const CARE_PER_PASS = Math.ceil(((PASS.find(([s]) => s === 'rooms')?.[1] ?? 0) - CARE_FROM) / CARE_MS);

/**
 * Сквозной номер визита заботы через `ms` от начала цикла: следующий круг продолжает счёт,
 * так что по кругу камера доходит до каждого, кому нужна помощь; null — не время визитов.
 */
export function careTurn(ms: number): number | null {
  const { shot, at } = shotAt(ms);
  if (shot !== 'rooms' || at < CARE_FROM) return null;
  const t = Math.max(0, ms);
  const lap = Math.floor(t / CYCLE_MS) * PASSES_PER_WALK + Math.floor((t % CYCLE_MS) / PASS_MS);
  return lap * CARE_PER_PASS + Math.floor((at - CARE_FROM) / CARE_MS);
}
