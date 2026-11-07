/** Точка мира, px. */
export interface Pt {
  x: number;
  y: number;
}

/** Где в зале стоят ноги питомца во время игр (ниже `y1` зал закрывает нижняя панель). */
export const HALL = { x0: 800, x1: 2000, y0: 1130, y1: 1410 };
/** Скорости, px мира в мс: бег (догонялки, мяч) и паровозик. */
export const RUN = 0.4;
export const TRAIN = 0.3;
/** Догонялки — столько кругов по `ringLoop`. */
export const CHASE_LAPS = 2;
/** Мяч: столько пинков; каждый уносит мяч на `KICK_MIN…KICK_MAX` px. */
export const KICKS = 6;
export const KICK_MIN = 350;
export const KICK_MAX = 600;

/**
 * Длительности сцен, мс: по ним `gameMs` считает бюджет игры, и `Hall` ждёт ровно столько же.
 * - `gather` — сбор на исходные места бегом (`RUN`) из любой точки зала: его диагональ / `RUN` ≈ 3,1 с;
 * - `joy` — радость в конце игры: `PetActor.joy()` (прыжок 650 мс) и облачко;
 * - `kick` — замах пинка, пока мяч не покатился; `roll` — мяч катится после пинка;
 * - `crouch` — перепрыгиваемый пригибается; `hop` — прыжок через него (`moveTo` с дугой).
 */
export const TIMING = {
  gather: Math.ceil(Math.hypot(HALL.x1 - HALL.x0, HALL.y1 - HALL.y0) / RUN),
  joy: 1_000,
  kick: 300,
  roll: 850,
  crouch: 200,
  hop: 520,
};

export type Game = 'chase' | 'ball' | 'train' | 'leap';

/** Чехарда одной группы: `start[k]` — место `members[k]`; `who` — индекс питомца (как в `members`), `arc` — высота дуги. */
export interface LeapGroup {
  members: number[];
  start: Pt[];
  hops: { who: number; to: Pt; arc: number }[];
}

/** Середина петель (центр круга догонялок). */
const CX = 1400;
const CY = 1265;
/** Мяч не ближе этого к краю зала по x: питомец встаёт сбоку от мяча и тоже остаётся в зале. */
const BALL_IN = 120;
/** Брожение не ближе этого к краю зала по x. */
const ROAM_IN = 60;
/** Чехарда: задние встают у левого края зала с этим отступом; шаг соседей — `(a + b) / 2 × scale × LEAP_GAP`. */
const LEAP_X0 = HALL.x0 + 40;
const LEAP_GAP = 0.75;
/** Ноги прыгуна проходят над перепрыгиваемым на этой доле его роста (`size × scale`): пригнувшийся ниже картинки. */
const CLEAR = 0.85;
/** Крайние дорожки чехарды не ближе этого к краю зала по y. */
const LANE_IN = 20;
/** = `HALL_SCALE` из `Hall.ts`: здесь без импорта — `Hall` сам зависит от этого модуля. */
const SCALE = 1.55;

const seg = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/** Длина ломаной. */
export function pathLength(points: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += seg(points[i - 1], points[i]);
  return len;
}

/** Точка на ломаной (непустой) на расстоянии `dist` от начала; меньше нуля — начало, дальше длины — конец. */
export function pointAt(points: readonly Pt[], dist: number): Pt {
  let left = Math.max(0, dist);
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const len = seg(a, b);
    if (len > 0 && left <= len) return { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len };
    left -= len;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}

/**
 * Куда смотреть на расстоянии `dist`: знак dx отрезка под этой точкой (за концом — последнего).
 * 0 — отрезок почти вертикален (|dx| ≤ 3): разворот на нём мигал бы, питомец смотрит как прежде.
 */
export function headingAt(points: readonly Pt[], dist: number): -1 | 0 | 1 {
  let left = Math.max(0, dist);
  let dx = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const len = seg(a, b);
    if (len === 0) continue;
    dx = b.x - a.x;
    if (left <= len) break;
    left -= len;
  }
  return Math.abs(dx) > 3 ? (dx < 0 ? -1 : 1) : 0;
}

/**
 * Отрезок пути по замкнутой петле (последняя точка петли совпадает с первой): от длины `from` (по модулю периметра,
 * можно меньше нуля) на `dist` вперёд, хоть на несколько кругов. Первая и последняя точки — на петле, между ними — её вершины.
 */
export function loopPath(loop: readonly Pt[], from: number, dist: number): Pt[] {
  const per = pathLength(loop);
  const start = ((from % per) + per) % per;
  const end = start + dist;
  const out = [pointAt(loop, start)];
  for (let base = 0; base < end; base += per) {
    let at = base;
    for (let i = 1; i < loop.length; i++) {
      at += seg(loop[i - 1], loop[i]);
      if (at > start && at < end) out.push({ x: loop[i].x, y: loop[i].y });
    }
  }
  out.push(pointAt(loop, end % per));
  return out;
}

/** Замкнутая петля из `n` точек кривой `at(t)`, t от 0 до 2π; последняя точка — копия первой. */
const closed = (n: number, at: (t: number) => Pt): Pt[] => {
  const pts = Array.from({ length: n }, (_, i) => at((2 * Math.PI * i) / n));
  return [...pts, { ...pts[0] }];
};

/**
 * Круг догонялок: эллипс с центром 1400×1265, радиусы 520×120. Начинается у правого края; бег против часовой
 * на экране: спереди (ближе к зрителю) слева направо, сзади справа налево. Периметр ≈ 2212 px.
 */
export function ringLoop(): Pt[] {
  return closed(120, (t) => ({ x: CX + 520 * Math.cos(t), y: CY - 120 * Math.sin(t) }));
}

/**
 * Петля паровозика — змейка: плоский эллипс 560×85 вокруг того же центра, сдвинутый по y волной 45 px с шагом 450 px
 * по x. Волна одна на обе стороны, поэтому петля себя не пересекает. Направление — как у `ringLoop`; круг ≈ 2,5 тыс. px.
 */
export function trainLoop(): Pt[] {
  return closed(240, (t) => {
    const x = CX + 560 * Math.cos(t);
    return { x, y: CY - 85 * Math.sin(t) + 45 * Math.sin((2 * Math.PI * (x - CX)) / 450) };
  });
}

/**
 * Куда покатится пнутый мяч: точка в зале (по x не ближе `BALL_IN` к краю) на `KICK_MIN…KICK_MAX` px от `from`.
 * Если за 40 попыток не нашлась — на 400 px вдоль зала в ту сторону, где места больше.
 */
export function ballSpot(from: Pt, rnd: () => number): Pt {
  const [lo, hi] = [HALL.x0 + BALL_IN, HALL.x1 - BALL_IN];
  for (let k = 0; k < 40; k++) {
    const p = { x: lo + rnd() * (hi - lo), y: HALL.y0 + rnd() * (HALL.y1 - HALL.y0) };
    const d = seg(from, p);
    if (d >= KICK_MIN && d <= KICK_MAX) return p;
  }
  const x = from.x + (from.x < CX ? 400 : -400);
  return { x: Math.min(hi, Math.max(lo, x)), y: Math.min(HALL.y1, Math.max(HALL.y0, from.y)) };
}

/** Случайная точка брожения в зале (по x не ближе `ROAM_IN` к краю). */
export function roamPoint(rnd: () => number): Pt {
  return { x: HALL.x0 + ROAM_IN + rnd() * (HALL.x1 - HALL.x0 - 2 * ROAM_IN), y: HALL.y0 + rnd() * (HALL.y1 - HALL.y0) };
}

/**
 * Чехарда для питомцев со сторонами картинок `sizes` в масштабе `scale`. Группы — пары по порядку индексов,
 * при нечётном числе последняя — тройка; меньше двух питомцев — групп нет. Дорожки групп по y — поровну по высоте зала.
 * Группа стоит слева направо в порядке `members`, задний у левого края; шаг соседей —
 * `(a + b) / 2 × scale × LEAP_GAP`. Прыгает всегда задний: перелетает всех и встаёт перед передним на тот же шаг.
 * Прыжки идут, пока место приземления в зале. Дуга такая, чтобы ноги прыгуна прошли над каждым на `CLEAR` его роста.
 */
export function leapPlan(sizes: readonly number[], scale: number): LeapGroup[] {
  const n = sizes.length;
  if (n < 2) return [];
  const groups: number[][] = [];
  for (let i = 0; i + 1 < n; i += 2) groups.push([i, i + 1]);
  if (n % 2) groups[groups.length - 1].push(n - 1);
  const gap = (a: number, b: number) => ((sizes[a] + sizes[b]) / 2) * scale * LEAP_GAP;
  const step = groups.length > 1 ? (HALL.y1 - HALL.y0 - 2 * LANE_IN) / (groups.length - 1) : 0;
  return groups.map((members, g) => {
    const y = groups.length > 1 ? HALL.y0 + LANE_IN + g * step : (HALL.y0 + HALL.y1) / 2;
    const x = new Map<number, number>();
    members.forEach((m, k) => x.set(m, k ? x.get(members[k - 1])! + gap(members[k - 1], m) : LEAP_X0));
    const start = members.map((m) => ({ x: x.get(m)!, y }));
    const line = [...members];
    const hops: LeapGroup['hops'] = [];
    for (;;) {
      const who = line[0];
      const front = line[line.length - 1];
      const [from, to] = [x.get(who)!, x.get(front)! + gap(front, who)];
      if (to > HALL.x1) break;
      const arc = Math.max(...line.slice(1).map((m) => (sizes[m] * scale * CLEAR) / Math.sin((Math.PI * (x.get(m)! - from)) / (to - from))));
      hops.push({ who, to: { x: to, y }, arc });
      x.set(who, to);
      line.push(line.shift()!);
    }
    return { members, start, hops };
  });
}

/**
 * Расчётное время игры, мс, для здоровых участников со сторонами картинок `sizes`: путь / скорость + паузы `TIMING`.
 * - догонялки: сбор на круг, `CHASE_LAPS` круга `ringLoop` бегом, радость;
 * - мяч: `KICKS` раз замах и пробег до мяча (`KICK_MAX` + 100 px, на которых пнувший стоял у мяча), радость;
 * - паровозик: сбор в цепочку на петле, один круг `trainLoop` шагом `TRAIN`, радость;
 * - чехарда: сбор на старт, самая длинная группа `leapPlan` (пригнулся + прыжок на каждый), радость.
 * Меньше двух здоровых — `Infinity`: такую игру `Hall` пропускает.
 */
export function gameMs(game: Game, sizes: readonly number[]): number {
  if (sizes.length < 2) return Infinity;
  const { gather, joy, kick, crouch, hop } = TIMING;
  switch (game) {
    case 'chase':
      return gather + (CHASE_LAPS * pathLength(ringLoop())) / RUN + joy;
    case 'ball':
      return KICKS * (kick + (KICK_MAX + 100) / RUN) + joy;
    case 'train':
      return gather + pathLength(trainLoop()) / TRAIN + joy;
    case 'leap':
      return gather + Math.max(...leapPlan(sizes, SCALE).map((g) => g.hops.length)) * (crouch + hop) + joy;
  }
}

/** Игры после догонялок: мяч, паровозик и чехарда в случайном порядке; при reduced motion без чехарды (нет дуг). */
export function gamesFor(reduced: boolean, rnd: () => number): Game[] {
  const list: Game[] = ['ball', 'train', 'leap'];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return reduced ? list.filter((g) => g !== 'leap') : list;
}
