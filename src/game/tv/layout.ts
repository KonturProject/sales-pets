import type { Shot } from './schedule';

/** Сцена экрана ТВ: рисуется в 1920×1080 и целиком масштабируется под окно. */
export const STAGE = { w: 1920, h: 1080 };
/** Мир: зал с досками рейтингов и домик; камера — `transform` мира. */
export const WORLD = { w: 2800, h: 1575 };
/** Домик 3×2 комнаты в координатах мира. */
export const HOUSE = { x: 600, y: 40, w: 1600, h: 900 };
export const ROOM = { w: 529, h: 446 };
const GAP = 6;
/** Доски рейтингов на стенах зала, 470×780. */
export const BOARDS = { heroes: { x: 70, y: 120 }, group: { x: 2260, y: 120 } };

export interface RoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** линия пола в мире: на ней стоят ноги питомца */
  floorY: number;
  cx: number;
  row: number;
}

/** Комната группы `i` (порядок `GROUPS`) в координатах мира. */
export function roomRect(i: number): RoomRect {
  const c = i % 3, r = Math.floor(i / 3);
  const x = HOUSE.x + c * (ROOM.w + GAP) + (c ? GAP / 2 : 0);
  const y = HOUSE.y + r * (ROOM.h + 8);
  return { x, y, w: ROOM.w, h: ROOM.h, floorY: y + ROOM.h - 40, cx: x + ROOM.w / 2, row: r };
}

/**
 * Положения камеры: `rooms` — домик между верхней строкой (64 px) и нижней панелью, `overview` — весь зал;
 * у досок — масштаб 1.15, доска в 80 px от края кадра и над нижней панелью, мир закрывает экран без пустых полос.
 */
export const CAMERA: Record<Shot, string> = {
  rooms: 'translate(-496px, 22.4px) scale(1.04)',
  overview: 'translate(57px, 64px) scale(0.64508)',
  walk: 'translate(57px, 64px) scale(0.64508)',
  heroes: 'translate(0px, -58px) scale(1.15)',
  group: 'translate(-1299px, -58px) scale(1.15)',
};
