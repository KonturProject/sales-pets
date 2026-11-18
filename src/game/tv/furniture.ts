import type { RoomTheme } from '@/art/manifest';
import { PLACES, type ItemId, type Place } from '@/engine/shop';

/** Прямоугольник в координатах комнаты 529×446 (или в долях картинки у `SCREEN`). */
export interface Box { x: number; y: number; w: number; h: number }

/** Интерфейс комнаты, на который мебель не заходит (`tv.css`): табличка по max-width, кучки — все пять. */
export const UI_BOXES: { sign: Box; ticker: Box; inv: Box; piles: Box } = {
  sign: { x: 16, y: 14, w: 250, h: 126 },
  ticker: { x: 293, y: 14, w: 220, h: 106 },
  inv: { x: 340, y: 396, w: 175, h: 38 },
  piles: { x: 14, y: 404, w: 196, h: 32 },
};

/** Размеры нарезанных картинок `public/assets/furniture/<id>.png`, px: по ним пропорции вещей. */
export const IMAGE_SIZE: Record<ItemId, readonly [number, number]> = {
  'desk-office': [256, 134], 'desk-wood': [256, 135], 'desk-gaming': [256, 135],
  'pc-crt': [250, 256], 'pc-laptop': [256, 198], 'pc-dual': [256, 181],
  'phone-rotary': [256, 207], 'phone-office': [256, 207],
  'chair-office': [199, 256], 'chair-beanbag': [256, 227], 'chair-fitball': [255, 256],
  'corner-ficus': [128, 256], 'corner-cactus': [103, 256], 'corner-cooler': [112, 256], 'corner-coffee': [162, 256],
  'rug-round': [256, 64], 'rug-striped': [256, 64], 'rug-paw': [256, 64],
  'wall-clock': [248, 256], 'wall-poster': [182, 256], 'wall-chart': [256, 193],
  'wall-diploma': [256, 209], 'wall-trophies': [256, 172],
  'window-garland': [256, 62], 'window-flowers': [256, 87],
};

/** Высота вещи в комнате, px; у столов, ковриков и вещей окна задана ширина (ниже). */
const HEIGHT: Partial<Record<ItemId, number>> = {
  'pc-crt': 76, 'pc-laptop': 66, 'pc-dual': 70,
  'phone-rotary': 36, 'phone-office': 36,
  'chair-office': 100, 'chair-beanbag': 74, 'chair-fitball': 76,
  'corner-ficus': 140, 'corner-cactus': 110, 'corner-cooler': 150, 'corner-coffee': 128,
  'wall-clock': 56, 'wall-poster': 72, 'wall-chart': 62, 'wall-diploma': 58, 'wall-trophies': 64,
};
/** Верх столешницы — доля высоты картинки стола от верха: на ней стоят компьютер и телефон (замер по нарезке). */
export const DESK_TOP: Record<'desk-office' | 'desk-wood' | 'desk-gaming', number> = {
  'desk-office': 0.13, 'desk-wood': 0.13, 'desk-gaming': 0.14,
};
/** Экраны компьютеров в долях картинки (замер тёмной заливки по нарезке): поверх — цифры группы. */
export const SCREEN: Record<'pc-crt' | 'pc-laptop' | 'pc-dual', Box[]> = {
  'pc-crt': [{ x: 0.116, y: 0.148, w: 0.572, h: 0.426 }],
  'pc-laptop': [{ x: 0.148, y: 0.096, w: 0.703, h: 0.495 }],
  'pc-dual': [{ x: 0.043, y: 0.088, w: 0.426, h: 0.409 }, { x: 0.531, y: 0.088, w: 0.426, h: 0.409 }],
};
/** Рамка окна темы (`art.ts`, `DECOR`): середина, ширина и низ, px комнаты. */
const WINDOW: Record<RoomTheme['decor'], { cx: number; w: number; bottom: number }> = {
  savanna: { cx: 265, w: 150, bottom: 208 },
  pond: { cx: 266, w: 160, bottom: 216 },
  sun: { cx: 266, w: 140, bottom: 210 },
  night: { cx: 266, w: 160, bottom: 216 },
  library: { cx: 266, w: 140, bottom: 210 },
  water: { cx: 266, w: 116, bottom: 214 },
};
/** Ноги мебели у стены (стена кончается на 340), px. */
const FLOOR_BACK = 372;
const DESK = { x: 16, w: 170 };
/** Гирлянда висит на окне ниже таблички (её низ 140): над окном места нет, там табличка и табло. */
const GARLAND_TOP = 142;
/** Пределы прогулки питомца (`EDGE` в `PetActor`). */
const PET_MIN = 70;
const PET_MAX = 459;
/** Порядок слоёв: коврик ниже всех, кресло ближе всех к зрителю. */
const Z: Record<Place, number> = { rug: 0, wallL: 1, wallR: 1, window: 1, desk: 2, corner: 2, pc: 3, phone: 3, chair: 4 };

const ratio = (id: ItemId) => IMAGE_SIZE[id][0] / IMAGE_SIZE[id][1];
const sized = (id: ItemId, w?: number) => (w !== undefined ? { w, h: Math.round(w / ratio(id)) } : { w: Math.round(HEIGHT[id]! * ratio(id)), h: HEIGHT[id]! });
/** Рамка по середине `cx` и низу `bottom`. */
const standing = (id: ItemId, cx: number, bottom: number, w?: number): Box => {
  const s = sized(id, w);
  return { x: Math.round(cx - s.w / 2), y: bottom - s.h, ...s };
};
const hanging = (id: ItemId, cx: number, top: number, w?: number): Box => {
  const s = sized(id, w);
  return { x: Math.round(cx - s.w / 2), y: top, ...s };
};

function deskBox(id: ItemId): Box {
  return standing(id, DESK.x + DESK.w / 2, FLOOR_BACK, DESK.w);
}

/** Рамка вещи на её месте; `null` — компьютер или телефон без стола. */
function boxOf(place: Place, id: ItemId, owned: Partial<Record<Place, ItemId>>, decor: RoomTheme['decor']): Box | null {
  if (place === 'pc' || place === 'phone') {
    const desk = owned.desk;
    if (!desk) return null;
    const d = deskBox(desk);
    const top = d.y + Math.round(DESK_TOP[desk as keyof typeof DESK_TOP] * d.h);
    return standing(id, place === 'pc' ? d.x + 58 : d.x + d.w - 30, top);
  }
  const win = WINDOW[decor];
  switch (place) {
    case 'desk': return deskBox(id);
    case 'chair': return standing(id, 232, 384);
    case 'corner': { const s = sized(id); return { x: 513 - s.w, y: FLOOR_BACK - s.h, ...s }; }
    case 'rug': { const s = sized(id, 170); return { x: 264 - s.w / 2, y: Math.round(373 - s.h / 2), ...s }; }
    case 'wallL': return hanging(id, 158, 150);
    case 'wallR': return hanging(id, 440, 134);
    case 'window': return id === 'window-garland'
      ? hanging(id, win.cx, GARLAND_TOP, win.w)
      : hanging(id, win.cx, win.bottom - 16, Math.min(win.w - 10, 140));
  }
}

/** Мебель комнаты в порядке мест: рамка (px комнаты) и слой. Компьютер и телефон без стола не ставятся. */
export function furnitureLayout(owned: Partial<Record<Place, ItemId>>, decor: RoomTheme['decor']): { id: ItemId; place: Place; box: Box; z: number }[] {
  return PLACES.flatMap((place) => {
    const id = owned[place];
    const box = id && boxOf(place, id, owned, decor);
    return box ? [{ id: id!, place, box, z: Z[place] }] : [];
  });
}

/** Где встать питомцу у вещи: середина её рамки в пределах прогулки; `null` — вещи нет. */
export function spotX(place: 'phone' | 'pc' | 'corner', owned: Partial<Record<Place, ItemId>>): number | null {
  const id = owned[place];
  const box = id && boxOf(place, id, owned, 'sun');
  return box ? Math.min(PET_MAX, Math.max(PET_MIN, Math.round(box.x + box.w / 2))) : null;
}
