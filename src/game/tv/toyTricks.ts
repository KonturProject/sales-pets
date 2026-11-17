import { BALL_EDGE } from './ball';
import type { ToyPlay } from './toys';

/**
 * Трюки десяти новых игрушек как данные, без DOM: путь игрушки, куда она встанет, когда питомцу прыгнуть, кивнуть,
 * сказать или пойти следом, и мелочи вокруг (пузыри, нотки, дымок, «дзынь!»). Проигрывают их `RoomView.playTrick`
 * (игрушка) и `PetActor.trick` (питомец) по одному объекту, поэтому они не расходятся. Координаты — комнаты: `x` —
 * середина игрушки, `up` — низ её рамки над полом, px.
 */
export type TrickPlay = Exclude<ToyPlay, 'hug' | 'bounce' | 'spin' | 'roll'>;

/** Ключевой кадр игрушки в доле `t` трюка; `ease` — переход от этого кадра к следующему; `sx` −1 — зеркально. */
export interface ToyKey {
  t: number;
  x: number;
  up: number;
  rot?: number;
  sx?: number;
  sy?: number;
  ease?: string;
}

/** Что делает питомец в долю `t` трюка; `walk` — идёт к `x` (px комнаты), остальное — на месте. */
export type PetCue =
  | { t: number; do: 'nod' | 'lean' | 'stretch' | 'joy' | 'alert' }
  | { t: number; do: 'jump'; h: number }
  | { t: number; do: 'say'; text: string }
  | { t: number; do: 'face'; dir: 1 | -1 }
  | { t: number; do: 'walk'; x: number };

/** Мелочь вокруг игрушки: появляется в долю `t` в точке (`x`, `up`), живёт `ms`, уходит вверх на `rise` и вбок на `dx`. */
export interface ToyFx {
  kind: 'bubble' | 'note' | 'smoke' | 'ring';
  t: number;
  x: number;
  up: number;
  ms: number;
  dx: number;
  rise: number;
}

export interface Trick {
  play: TrickPlay;
  ms: number;
  keys: ToyKey[];
  /** где игрушка лежит после трюка; у тех, что держат в руке, — прежнее место */
  endX: number;
  /** куда смотрит картинка после трюка (нос самолётика и машинки), `sx` кадров — относительно этого */
  face?: 1 | -1;
  /** `rot` крутит картинку вокруг её середины (йо-йо, попрыгунчик), а не всю игрушку вокруг точки на полу */
  spin?: boolean;
  cues: PetCue[];
  fx: ToyFx[];
  /** нитка йо-йо от лапы (`x`, `up`) к середине игрушки, пока `t` между `from` и `to` */
  string?: { x: number; up: number; from: number; to: number };
}

/**
 * Где всё происходит: игрушка в `toyX`, питомец в `petX` смотрит на неё (`dir`), сторона его картинки `side`, стоит от
 * игрушки на `reach`; ширина комнаты `roomW`, к стене питомец ближе `petEdge` не подходит; высота рамки игрушки `toyH`.
 */
export interface TrickGeo {
  toyX: number;
  petX: number;
  dir: 1 | -1;
  side: number;
  reach: number;
  roomW: number;
  petEdge: number;
  toyH: number;
  rnd: () => number;
}

/** Выше этого (px над полом) не поднимается верх картинки игрушки: таблички комнаты начинаются выше 275 px. */
export const CEIL = 250;
/** Лапа питомца над полом и вбок от его середины; макушка — в долях стороны картинки. */
export const paw = (side: number) => ({ out: Math.round(0.32 * side), up: Math.round(0.42 * side) });
export const head = (side: number) => Math.round(0.95 * side);
/** Что питомец говорит в игрушечный телефон: мы колл-центр. */
export const PHONE = ['Алло! Оплата?', 'Записываю!', 'Да, слушаю!'];
/** Йо-йо малыш держит не ниже этого, px: иначе нитки не видно — ей некуда опускаться. */
const YOYO_MIN = 84;
/** Йо-йо висит в стольких долях стороны картинки вбок от середины питомца: сбоку от тела, а не за ним. */
const YOYO_OUT = 0.45;

const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));
const floor = (g: TrickGeo) => ({ lo: BALL_EDGE, hi: g.roomW - BALL_EDGE });
/** Лапа над полом в комнате: игрушка в руке не выходит за стены. */
const hand = (g: TrickGeo) => {
  const p = paw(g.side);
  return { x: clamp(g.petX + g.dir * p.out, g.toyH / 2, g.roomW - g.toyH / 2), up: p.up };
};
/** Где встать питомцу, чтобы играть с игрушкой в `x`: по эту сторону от неё на `reach`, не у самой стены. */
const stand = (g: TrickGeo, x: number) => {
  const side = x >= g.petX ? 1 : -1;
  return clamp(x - side * g.reach, g.petEdge, g.roomW - g.petEdge);
};
const key = (t: number, x: number, up: number, o: Partial<ToyKey> = {}): ToyKey => ({ t, x, up: Math.round(up), ...o });

/** Шарик: взял за ниточку (её конец — низ картинки — у лапы), покачал над головой, отпустил, подпрыгнул и поймал. */
function float(g: TrickGeo): Trick {
  const h = hand(g);
  const top = Math.min(CEIL - g.toyH, h.up + 60);
  return {
    play: 'float', ms: 3400, endX: g.toyX,
    keys: [
      key(0, g.toyX, 0, { ease: 'ease-out' }),
      key(0.12, h.x, h.up),
      key(0.24, h.x, h.up + 6, { rot: 6 }),
      key(0.36, h.x, h.up, { rot: -6 }),
      key(0.48, h.x, h.up + 6, { rot: 5 }),
      key(0.56, h.x, h.up, { ease: 'ease-out' }),
      key(0.7, clamp(h.x + g.dir * 8, g.toyH / 2, g.roomW - g.toyH / 2), top, { rot: -5 }),
      key(0.78, h.x, h.up + 24),
      key(0.86, h.x, h.up, { rot: 3, ease: 'ease-in' }),
      key(1, g.toyX, 0),
    ],
    // прыжок (650 мс, верх на середине) в верхней точке шарика
    cues: [{ t: 0.06, do: 'nod' }, { t: 0.6, do: 'jump', h: 44 }, { t: 0.9, do: 'joy' }],
    fx: [],
  };
}

/**
 * Йо-йо: на нитке сбоку от питомца три раза вниз почти до пола и обратно под лапу, крутясь; на третий раз питомец
 * подпрыгивает.
 */
function yoyo(g: TrickGeo): Trick {
  const h = { x: clamp(g.petX + g.dir * Math.round(YOYO_OUT * g.side), g.toyH / 2, g.roomW - g.toyH / 2), up: paw(g.side).up };
  const anchor = Math.max(h.up, YOYO_MIN);
  const hang = anchor - g.toyH - 2;
  const keys = [key(0, g.toyX, 0, { ease: 'ease-out' }), key(0.1, h.x, hang, { ease: 'ease-in' })];
  let rot = 0;
  for (let i = 0; i < 3; i++) {
    const t0 = 0.1 + i * 0.26;
    keys.push(key(t0 + 0.13, h.x, 6, { rot: (rot += 360), ease: 'ease-out' }), key(t0 + 0.26, h.x, hang, { rot: (rot += 360), ease: 'ease-in' }));
  }
  keys.push(key(1, g.toyX, 0, { rot }));
  return {
    play: 'yoyo', ms: 2800, endX: g.toyX, keys, spin: true,
    string: { x: h.x, up: anchor, from: 0.1, to: 0.88 },
    cues: [{ t: 0.1, do: 'nod' }, { t: 0.36, do: 'nod' }, { t: 0.62, do: 'nod' }, { t: 0.78, do: 'jump', h: 30 }, { t: 0.93, do: 'joy' }],
    fx: [],
  };
}

/** Самолётик: поднял, замахнулся, бросил туда, где есть место; летит дугой носом вперёд и садится; питомец идёт к нему. */
function glide(g: TrickGeo): Trick {
  const { lo, hi } = floor(g);
  const h = hand(g);
  const d: 1 | -1 = (g.dir > 0 ? hi - h.x : h.x - lo) >= 160 ? g.dir : g.dir > 0 ? -1 : 1;
  const endX = clamp(h.x + d * (200 + g.rnd() * 100), lo, hi);
  const span = endX - h.x;
  const top = Math.min(CEIL - g.toyH, h.up + 50);
  const cues: PetCue[] = [{ t: 0.08, do: 'nod' }];
  if (d !== g.dir) cues.push({ t: 0.12, do: 'face', dir: d });
  cues.push({ t: 0.2, do: 'lean' }, { t: 0.55, do: 'walk', x: stand(g, endX) }, { t: 0.98, do: 'joy' });
  return {
    play: 'glide', ms: 2000, endX, face: d,
    keys: [
      key(0, g.toyX, 0, { ease: 'ease-out' }),
      key(0.15, h.x, h.up, { rot: -10 * d }),
      key(0.22, clamp(h.x - d * 8, g.toyH / 2, g.roomW - g.toyH / 2), h.up + 6, { rot: -16 * d, ease: 'ease-out' }),
      key(0.45, h.x + Math.round(span * 0.4), top, { rot: -6 * d }),
      key(0.8, h.x + Math.round(span * 0.88), 16, { rot: 12 * d, ease: 'ease-out' }),
      key(0.9, endX - d * 8, 0, { rot: 3 * d, ease: 'ease-out' }),
      key(1, endX, 0),
    ],
    cues,
    fx: [],
  };
}

/** Машинка: питомец заводит (дрожит), она едет к дальней стене, тычется в неё и едет назад до середины пути. */
function drive(g: TrickGeo): Trick {
  const { lo, hi } = floor(g);
  const d: 1 | -1 = hi - g.toyX >= g.toyX - lo ? 1 : -1;
  const wall = d > 0 ? hi : lo;
  const endX = Math.round((g.toyX + wall) / 2);
  const there = { sx: -1 }; // туда — зеркально к итоговому виду (назад)
  return {
    play: 'drive', ms: 3000, endX, face: d > 0 ? -1 : 1,
    keys: [
      key(0, g.toyX, 0, there),
      key(0.06, g.toyX, 2, { ...there, rot: 3 }),
      key(0.12, g.toyX, 0, { ...there, rot: -3 }),
      key(0.18, g.toyX, 2, { ...there, rot: 3 }),
      key(0.24, g.toyX, 0, { ...there, ease: 'ease-in' }),
      key(0.56, wall, 0, { ...there, ease: 'ease-out' }),
      key(0.59, wall - d * 4, 8, { ...there, rot: 6 }),
      key(0.62, wall - d * 6, 0, { ease: 'ease-in-out' }),
      key(0.94, endX, 0, { ease: 'ease-out' }),
      key(1, endX, 0),
    ],
    cues: [{ t: 0.04, do: 'nod' }, { t: 0.14, do: 'nod' }, { t: 0.62, do: 'walk', x: stand(g, endX) }, { t: 0.97, do: 'joy' }],
    fx: [],
  };
}

/** Пузыри: баночка наклоняется к питомцу, из колечка вылетают шесть пузырей, всплывают и лопаются; за одним он прыгает. */
function bubbles(g: TrickGeo): Trick {
  const tilt = -8 * g.dir;
  const ring = { x: g.toyX - g.dir * 6, up: g.toyH - 4 };
  const fx: ToyFx[] = Array.from({ length: 6 }, (_, k) => ({
    kind: 'bubble' as const,
    t: 0.12 + k * 0.09,
    x: ring.x,
    up: ring.up,
    ms: 1200 + Math.round(g.rnd() * 500),
    dx: Math.round((g.rnd() - 0.5) * 70),
    rise: Math.min(CEIL - ring.up, 100 + Math.round(g.rnd() * 70)),
  }));
  return {
    play: 'bubbles', ms: 3000, endX: g.toyX,
    keys: [key(0, g.toyX, 0), key(0.1, g.toyX, 0, { rot: tilt }), key(0.75, g.toyX, 0, { rot: tilt }), key(0.85, g.toyX, 0), key(1, g.toyX, 0)],
    cues: [{ t: 0.06, do: 'lean' }, { t: 0.5, do: 'jump', h: 34 }, { t: 0.85, do: 'joy' }],
    fx,
  };
}

/** Барабан: четыре удара; от каждого барабан сплющивается и вылетает нотка. */
function drum(g: TrickGeo): Trick {
  const hits = [0.12, 0.32, 0.52, 0.72];
  const keys = [key(0, g.toyX, 0)];
  for (const h of hits) {
    keys.push(key(h - 0.02, g.toyX, 0), key(h + 0.03, g.toyX, 0, { sx: 1.1, sy: 0.86 }), key(h + 0.1, g.toyX, 0));
  }
  keys.push(key(1, g.toyX, 0));
  return {
    play: 'drum', ms: 2400, endX: g.toyX, keys,
    cues: [...hits.map((h) => ({ t: h - 0.06, do: 'nod' as const })), { t: 0.88, do: 'joy' }],
    fx: hits.map((h) => ({
      kind: 'note' as const, t: h + 0.02, x: g.toyX + Math.round((g.rnd() - 0.5) * 20), up: g.toyH, ms: 1100,
      dx: Math.round((g.rnd() - 0.5) * 50), rise: 70 + Math.round(g.rnd() * 30),
    })),
  };
}

/** Телефон: звонит (дрожит, «дзынь!»), питомец пугается, берёт трубку и отвечает репликой колл-центра. */
function call(g: TrickGeo): Trick {
  const keys = [key(0, g.toyX, 0)];
  for (let i = 1; i < 12; i++) keys.push(key(i * 0.025, g.toyX, i % 2 ? 3 : 0, { rot: i % 2 ? 9 : -9 }));
  keys.push(key(0.3, g.toyX, 0), key(1, g.toyX, 0));
  const ring = (t: number): ToyFx => ({ kind: 'ring', t, x: g.toyX, up: g.toyH + 6, ms: 700, dx: 0, rise: 16 });
  return {
    play: 'call', ms: 3200, endX: g.toyX, keys,
    cues: [
      { t: 0.02, do: 'alert' },
      { t: 0.32, do: 'nod' },
      { t: 0.36, do: 'say', text: PHONE[Math.min(PHONE.length - 1, Math.floor(g.rnd() * PHONE.length))]! },
      { t: 0.9, do: 'joy' },
    ],
    fx: [ring(0.02), ring(0.17)],
  };
}

/** Попрыгунчик: бросил об пол, мячик скачет затухающими отскоками (от стены — обратно); питомец идёт за ним. */
function hop(g: TrickGeo): Trick {
  const { lo, hi } = floor(g);
  const h = hand(g);
  let x = clamp(h.x + g.dir * 10, lo, hi);
  let d = g.dir;
  const keys = [key(0, g.toyX, 0, { ease: 'ease-out' }), key(0.08, h.x, h.up, { ease: 'ease-in' }), key(0.16, x, 0, { sx: 1.2, sy: 0.8, ease: 'ease-out' })];
  let t = 0.16;
  let rot = 0;
  for (const [ms, up, run] of [[0.26, 110, 90], [0.2, 64, 60], [0.14, 30, 36], [0.1, 12, 18]] as const) {
    let to = x + d * run;
    if (to > hi) [to, d] = [hi - (to - hi), -1];
    else if (to < lo) [to, d] = [lo + (lo - to), 1];
    to = clamp(to, lo, hi);
    rot += Math.round((to - x) * 2.2);
    keys.push(key(t + ms / 2, Math.round((x + to) / 2), up, { rot: rot - Math.round((to - x) * 1.1), ease: 'ease-in' }));
    t += ms;
    keys.push(key(t, to, 0, { rot, sx: 1.12, sy: 0.88, ease: 'ease-out' }));
    x = to;
  }
  keys.push(key(1, x, 0, { rot }));
  return {
    play: 'hop', ms: 2400, endX: x, keys, spin: true,
    cues: [{ t: 0.06, do: 'nod' }, { t: 0.45, do: 'walk', x: stand(g, x) }, { t: 0.95, do: 'joy' }],
    fx: [],
  };
}

/** Ракета: питомец отходит на шаг; ракета дрожит, внизу дымок, взлетает под потолок и медленно, покачиваясь, садится. */
function launch(g: TrickGeo): Trick {
  const x = g.toyX;
  const keys = [
    key(0, x, 0),
    key(0.12, x, 0),
    key(0.16, x, 1, { rot: 3 }),
    key(0.2, x, 0, { rot: -3 }),
    key(0.24, x, 1, { rot: 3 }),
    key(0.28, x, 0, { sx: 1.06, sy: 0.92, ease: 'cubic-bezier(.5, 0, 1, 1)' }),
    key(0.52, x, CEIL - g.toyH, { ease: 'ease-out' }),
    key(0.58, x, CEIL - g.toyH - 4, { ease: 'ease-in-out' }),
    key(0.7, clamp(x + 12, g.toyH / 2, g.roomW - g.toyH / 2), 170, { rot: 8 }),
    key(0.82, clamp(x - 10, g.toyH / 2, g.roomW - g.toyH / 2), 90, { rot: -8 }),
    key(0.93, x, 0, { sx: 1.1, sy: 0.9, ease: 'ease-out' }),
    key(1, x, 0),
  ];
  return {
    play: 'launch', ms: 3800, endX: x, keys,
    cues: [
      { t: 0, do: 'walk', x: clamp(g.petX - g.dir * 50, g.petEdge, g.roomW - g.petEdge) },
      { t: 0.15, do: 'face', dir: g.dir }, // отошёл спиной к ракете — повернулся посмотреть
      { t: 0.45, do: 'jump', h: 36 },
      { t: 0.96, do: 'joy' },
    ],
    fx: [0.14, 0.2, 0.26, 0.32].map((t) => ({
      kind: 'smoke' as const, t, x: x + Math.round((g.rnd() - 0.5) * 16), up: 2, ms: 900, dx: Math.round((g.rnd() - 0.5) * 40), rise: 14,
    })),
  };
}

/** Гантелька: взял в лапу и трижды поднял над головой; на третий раз подержал и радуется. */
function lift(g: TrickGeo): Trick {
  const h = hand(g);
  const low = Math.max(0, h.up - 16);
  const over = Math.min(CEIL - g.toyH, head(g.side) + 2);
  const above = clamp(g.petX, g.toyH / 2, g.roomW - g.toyH / 2);
  return {
    play: 'lift', ms: 2800, endX: g.toyX,
    keys: [
      key(0, g.toyX, 0, { ease: 'ease-out' }),
      key(0.1, h.x, low),
      key(0.22, above, over),
      key(0.34, h.x, low),
      key(0.48, above, over),
      key(0.6, h.x, low),
      key(0.74, above, over),
      key(0.84, above, over),
      key(0.92, h.x, low, { ease: 'ease-in' }),
      key(1, g.toyX, 0),
    ],
    cues: [{ t: 0.06, do: 'nod' }, { t: 0.18, do: 'stretch' }, { t: 0.44, do: 'stretch' }, { t: 0.7, do: 'stretch' }, { t: 0.86, do: 'joy' }],
    fx: [],
  };
}

export const TRICKS: Record<TrickPlay, (g: TrickGeo) => Trick> = {
  float, yoyo, glide, drive, bubbles, drum, call, hop, launch, lift,
};

export const isTrick = (play: ToyPlay | 'ball'): play is TrickPlay => Object.hasOwn(TRICKS, play);
