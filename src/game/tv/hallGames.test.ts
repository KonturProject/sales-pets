import { describe, expect, it } from 'vitest';
import {
  CHASE_LAPS, HALL, HALL_SCALE, KICK_MAX, KICK_MIN, RUN, TIMING, TRAIN, ballSpot, ballWatch, gameMs, gamesFor, headingAt,
  homeLead, hopMs, kickSpot, leapDelay, leapPlan, loopPath, nearestOnLoop, pathLength, pointAt, ringLoop, roamLeg, roamPoint,
  trainLoop, watchSpot, type Game, type Pt,
} from './hallGames';

/** Детерминированный генератор (LCG) для серий случайных вызовов. */
const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const SCALE = HALL_SCALE;
const GAMES: Game[] = ['chase', 'ball', 'train', 'leap'];
const inHall = (p: Pt) => p.x >= HALL.x0 && p.x <= HALL.x1 && p.y >= HALL.y0 && p.y <= HALL.y1;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/** Сколько раз ломаная меняет направление по y (вверх ↔ вниз). */
const yTurns = (pts: readonly Pt[]) => {
  let turns = 0;
  let last = 0;
  for (let i = 1; i < pts.length; i++) {
    const s = Math.sign(pts[i].y - pts[i - 1].y);
    if (s && last && s !== last) turns++;
    if (s) last = s;
  }
  return turns;
};

describe('pathLength и pointAt', () => {
  const path = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }];

  it('длина ломаной — сумма отрезков', () => {
    expect(pathLength(path)).toBe(11);
  });

  it('точка на расстоянии от начала, с зажимом в концы', () => {
    expect(pointAt(path, 5)).toEqual({ x: 3, y: 4 });
    expect(pointAt(path, 8)).toEqual({ x: 3, y: 7 });
    expect(pointAt(path, -1)).toEqual({ x: 0, y: 0 });
    expect(pointAt(path, 99)).toEqual({ x: 3, y: 10 });
  });

  it('нулевые отрезки (питомец уже стоит в первой точке) не дают NaN', () => {
    const p = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(pathLength(p)).toBe(10);
    expect(pointAt(p, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAt(p, 5)).toEqual({ x: 5, y: 0 });
    expect(pointAt([{ x: 2, y: 3 }], 4)).toEqual({ x: 2, y: 3 });
  });
});

describe('headingAt', () => {
  it('знак dx отрезка под точкой; почти вертикальный отрезок (|dx| ≤ 3) — 0, без поворота', () => {
    // отрезки: 0 (нулевой), 10 вправо, почти вертикальный (dx = 2, длина ≈ 50), 52 влево
    const p = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 12, y: 50 }, { x: -40, y: 50 }];
    expect(headingAt(p, 0)).toBe(1);
    expect(headingAt(p, 5)).toBe(1);
    expect(headingAt(p, 30)).toBe(0);
    expect(headingAt(p, 70)).toBe(-1);
    expect(headingAt(p, 999)).toBe(-1);
  });
});

describe('loopPath', () => {
  // квадрат 100×100, замкнут явно; периметр 400
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }];

  it('через начало петли: длина = dist, концы на своих местах', () => {
    const p = loopPath(sq, 350, 100);
    expect(pathLength(p)).toBeCloseTo(100, 6);
    expect(p[0]).toEqual({ x: 0, y: 50 });
    expect(p.at(-1)).toEqual({ x: 50, y: 0 });
  });

  it('два круга с середины петли', () => {
    const p = loopPath(sq, 150, 800);
    expect(pathLength(p)).toBeCloseTo(800, 6);
    expect(p[0]).toEqual(pointAt(sq, 150));
    expect(p.at(-1)).toEqual(pointAt(sq, 150));
  });

  it('отрицательный from — по модулю периметра (хвост паровозика позади ведущего)', () => {
    const p = loopPath(sq, -50, 120);
    expect(pathLength(p)).toBeCloseTo(120, 6);
    expect(p[0]).toEqual({ x: 0, y: 50 });
    expect(p.at(-1)).toEqual({ x: 70, y: 0 });
  });

  it('на кольце догонялок: два периметра с любого места', () => {
    const ring = ringLoop();
    const per = pathLength(ring);
    const p = loopPath(ring, 1000, 2 * per);
    expect(Math.abs(pathLength(p) - 2 * per)).toBeLessThanOrEqual(1);
    expect(dist(p[0], pointAt(ring, 1000))).toBeLessThan(1e-6);
    expect(dist(p.at(-1)!, pointAt(ring, 1000))).toBeLessThan(1e-6);
  });
});

describe('ringLoop', () => {
  const ring = ringLoop();

  it('эллипс 1400×1265, радиусы 520×120: ≥ 48 точек, в зале, замкнут, периметр 2212 ± 30', () => {
    expect(ring.length).toBeGreaterThanOrEqual(48);
    expect(ring.every(inHall)).toBe(true);
    expect(ring.at(-1)).toEqual(ring[0]);
    expect(Math.abs(pathLength(ring) - 2212)).toBeLessThanOrEqual(30);
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(880, 0);
    expect(Math.max(...xs)).toBeCloseTo(1920, 0);
    expect(Math.min(...ys)).toBeCloseTo(1145, 0);
    expect(Math.max(...ys)).toBeCloseTo(1385, 0);
  });

  it('бег против часовой на экране: спереди (ближе к зрителю) слева направо, сзади справа налево', () => {
    for (let i = 1; i < ring.length; i++) {
      const [a, b] = [ring[i - 1], ring[i]];
      if (a.y > 1325 && b.y > 1325) expect(b.x).toBeGreaterThan(a.x);
      if (a.y < 1205 && b.y < 1205) expect(b.x).toBeLessThan(a.x);
    }
  });
});

describe('trainLoop', () => {
  const train = trainLoop();

  it('в зале, замкнута, один круг 2000…2600 px', () => {
    expect(train.every(inHall)).toBe(true);
    expect(train.at(-1)).toEqual(train[0]);
    const per = pathLength(train);
    expect(per).toBeGreaterThanOrEqual(2000);
    expect(per).toBeLessThanOrEqual(2600);
  });

  it('змейка: отличается от кольца и волнистее его', () => {
    const ring = ringLoop();
    const far = Math.max(...train.map((p) => Math.min(...ring.map((q) => dist(p, q)))));
    expect(far).toBeGreaterThan(40);
    expect(yTurns(ring)).toBe(2);
    expect(yTurns(train)).toBeGreaterThanOrEqual(6);
  });
});

describe('ballSpot и roamPoint', () => {
  it('ballSpot: 200 пинков, в том числе из углов зала, — мяч в зале, от KICK_MIN до KICK_MAX', () => {
    const rnd = lcg(11);
    const corners = [
      { x: HALL.x0, y: HALL.y0 }, { x: HALL.x1, y: HALL.y0 }, { x: HALL.x0, y: HALL.y1 }, { x: HALL.x1, y: HALL.y1 },
      { x: 1400, y: 1270 },
    ];
    let from: Pt = corners[0];
    for (let i = 0; i < 200; i++) {
      if (i % 4 === 0) from = corners[(i / 4) % corners.length];
      const p = ballSpot(from, rnd);
      expect(inHall(p)).toBe(true);
      expect(dist(p, from)).toBeGreaterThanOrEqual(KICK_MIN);
      expect(dist(p, from)).toBeLessThanOrEqual(KICK_MAX);
      from = p;
    }
  });

  it('ballSpot: даже при «невезучем» генераторе мяч летит не ближе KICK_MIN', () => {
    const p = ballSpot({ x: 1400, y: 1270 }, () => 0.5);
    expect(inHall(p)).toBe(true);
    expect(dist(p, { x: 1400, y: 1270 })).toBeGreaterThanOrEqual(KICK_MIN);
    expect(dist(p, { x: 1400, y: 1270 })).toBeLessThanOrEqual(KICK_MAX);
  });

  it('roamPoint: 200 точек — все в зале', () => {
    const rnd = lcg(5);
    for (let i = 0; i < 200; i++) expect(inHall(roamPoint(rnd))).toBe(true);
  });
});

describe('leapPlan', () => {
  const rnd = lcg(21);
  const cases: number[][] = [];
  for (let n = 2; n <= 6; n++) {
    cases.push(Array(n).fill(120), Array(n).fill(230), Array(n).fill(94), Array(n).fill(170));
    for (let k = 0; k < 6; k++) cases.push(Array.from({ length: n }, () => (rnd() < 0.5 ? 120 : 230)));
  }
  const gapMin = (sizes: number[], a: number, b: number) => ((sizes[a] + sizes[b]) / 2) * SCALE * 0.6;

  it('пары (при нечётном одна тройка), каждый питомец ровно в одной группе', () => {
    for (const sizes of cases) {
      const plan = leapPlan(sizes, SCALE);
      const all = plan.flatMap((g) => g.members).sort((a, b) => a - b);
      expect(all).toEqual([...sizes.keys()]);
      expect(plan.every((g) => g.members.length === 2 || g.members.length === 3)).toBe(true);
      expect(plan.filter((g) => g.members.length === 3).length).toBe(sizes.length % 2);
    }
  });

  it('у каждой группы своя дорожка по y внутри зала; старт и все прыжки — на ней и в зале', () => {
    for (const sizes of cases) {
      const plan = leapPlan(sizes, SCALE);
      const lanes = plan.map((g) => g.start[0].y);
      expect(new Set(lanes).size).toBe(plan.length);
      plan.forEach((g, k) => {
        expect(g.start.length).toBe(g.members.length);
        expect(g.hops.length).toBeGreaterThan(0);
        for (const p of [...g.start, ...g.hops.map((h) => h.to)]) {
          expect(inHall(p)).toBe(true);
          expect(p.y).toBe(lanes[k]);
        }
      });
    }
  });

  it('прыжки слева направо: задний перелетает всех, соседи не ближе (a + b) / 2 × scale × 0,6, дуга ≥ 0,8 роста', () => {
    for (const sizes of cases) {
      for (const g of leapPlan(sizes, SCALE)) {
        const x = new Map(g.members.map((m, k) => [m, g.start[k].x]));
        const checkGaps = () => {
          const line = [...g.members].sort((a, b) => x.get(a)! - x.get(b)!);
          for (let k = 1; k < line.length; k++) {
            expect(x.get(line[k])! - x.get(line[k - 1])!).toBeGreaterThanOrEqual(gapMin(sizes, line[k], line[k - 1]));
          }
        };
        checkGaps();
        for (const hop of g.hops) {
          expect(g.members).toContain(hop.who);
          const others = g.members.filter((m) => m !== hop.who);
          expect(Math.min(...others.map((m) => x.get(m)!))).toBeGreaterThan(x.get(hop.who)!);
          expect(hop.to.x).toBeGreaterThan(Math.max(...others.map((m) => x.get(m)!)));
          for (const m of others) expect(hop.arc).toBeGreaterThanOrEqual(0.8 * sizes[m] * SCALE);
          x.set(hop.who, hop.to.x);
          checkGaps();
        }
      }
    }
  });

  it('меньше двух питомцев — прыгать некому', () => {
    expect(leapPlan([], SCALE)).toEqual([]);
    expect(leapPlan([120], SCALE)).toEqual([]);
  });

  it('размер 0 или NaN не вешает план: такая группа без прыжков', () => {
    expect(leapPlan([0, 0], SCALE).map((g) => g.hops.length)).toEqual([0]);
    expect(leapPlan([NaN, 120], SCALE).map((g) => g.hops.length)).toEqual([0]);
    expect(leapPlan([0, 0, 120, 120], SCALE).map((g) => g.hops.length > 0)).toEqual([false, true]);
  });

  it('прыжок тройки дольше прыжка пары по числу зазоров; группы стартуют вразнобой, в пределах одного прыжка', () => {
    const [pair, trio] = [leapPlan([120, 120], SCALE)[0], leapPlan([120, 120, 120], SCALE)[0]];
    expect(hopMs(pair)).toBe(TIMING.hop);
    expect(hopMs(trio)).toBe(TIMING.hop * 1.5);
    for (const n of [1, 2, 3]) {
      const delays = Array.from({ length: n }, (_, g) => leapDelay(g, n));
      expect(delays[0]).toBe(0);
      expect(new Set(delays).size).toBe(n);
      expect(Math.max(...delays)).toBeLessThan(TIMING.crouch + TIMING.hop);
    }
  });
});

describe('nearestOnLoop', () => {
  const ring = ringLoop();
  const per = pathLength(ring);

  it('расстояние вдоль петли до ближайшей к точке вершины', () => {
    expect(nearestOnLoop(ring, { x: 1950, y: 1265 })).toBe(0);
    expect(nearestOnLoop(ring, { x: 860, y: 1265 })).toBeCloseTo(per / 2, -1);
    expect(nearestOnLoop(ring, { x: 1400, y: 1100 })).toBeCloseTo(per / 4, -1);
    expect(nearestOnLoop(ring, { x: 1400, y: 1400 })).toBeCloseTo((3 * per) / 4, -1);
  });

  it('точка петли на найденном расстоянии — ближайшая к питомцу', () => {
    const rnd = lcg(5);
    for (let k = 0; k < 50; k++) {
      const p = roamPoint(rnd);
      const best = Math.min(...ring.map((q) => dist(q, p)));
      expect(dist(pointAt(ring, nearestOnLoop(ring, p)), p)).toBeCloseTo(best, 6);
    }
  });
});

describe('roamLeg', () => {
  const from = { x: 1000, y: 1200 };

  it('успевает — до самой точки', () => {
    expect(roamLeg(from, { x: 1400, y: 1200 }, 5_000, 0.2)).toEqual({ x: 1400, y: 1200 });
  });

  it('не успевает — отрезок короче, на той же прямой, ровно на время', () => {
    const leg = roamLeg(from, { x: 1600, y: 1200 }, 1_000, 0.2)!;
    expect(leg.x).toBeCloseTo(1200);
    expect(leg.y).toBeCloseTo(1200);
  });

  it('времени меньше чем на 40 px (или его нет) — null: питомец ждёт срока', () => {
    expect(roamLeg(from, { x: 1600, y: 1200 }, 150, 0.2)).toBeNull();
    expect(roamLeg(from, { x: 1600, y: 1200 }, -500, 0.2)).toBeNull();
    expect(roamLeg(from, { x: 1600, y: 1200 }, NaN, 0.2)).toBeNull();
  });

  it('точка рядом, а время есть — короткий отрезок, не null (брожение не обрывается)', () => {
    expect(roamLeg(from, { x: 1010, y: 1200 }, 5_000, 0.2)).toEqual({ x: 1010, y: 1200 });
    expect(roamLeg(from, from, 5_000, 0.2)).toEqual(from);
  });
});

describe('больной смотрит на игры', () => {
  it('watchSpot: вне игровой площадки, со стороны своей комнаты, y 1180; второй больной — на ряд ближе', () => {
    expect(watchSpot(864.5, 0)).toEqual({ x: HALL.x0 - 260, y: 1180 });
    expect(watchSpot(1935.5, 0)).toEqual({ x: HALL.x1 + 260, y: 1180 });
    expect(watchSpot(1402.5, 0).x).toBe(HALL.x1 + 260); // средняя комната чуть правее середины зала
    expect(watchSpot(864.5, 1)).toEqual({ x: HALL.x0 - 260, y: 1270 });
    for (const cx of [864.5, 1402.5, 1935.5]) {
      const p = watchSpot(cx, 0);
      expect(p.x < HALL.x0 || p.x > HALL.x1).toBe(true);
    }
  });

  it('homeLead: за сколько до срока идти к двери, чтобы дойти за отведённое; успевает — 0', () => {
    const door = { x: 1400, y: 1060 };
    expect(homeLead({ x: 2260, y: 1060 }, door, 0.1, 5_000)).toBeCloseTo(8_600 - 5_000);
    expect(homeLead({ x: 1600, y: 1060 }, door, 0.1, 5_000)).toBe(0);
    expect(homeLead(door, door, 0.1, 5_000)).toBe(0);
  });
});

describe('мяч: где встать пинающему и зрителям', () => {
  /** Угол между направлением от мяча к точке и линией полёта (`dir` по x), 0…π. */
  const angle = (p: Pt, ball: Pt, dir: 1 | -1) => Math.abs(Math.atan2(p.y - ball.y, (p.x - ball.x) * dir));

  it('kickSpot: сбоку от мяча, против полёта, на той же глубине, в зале', () => {
    const ball = { x: 1300, y: 1250 };
    const right = kickSpot(ball, 1, 170);
    expect(right.y).toBe(ball.y);
    expect(right.x).toBeLessThan(ball.x - 60);
    expect(kickSpot(ball, -1, 170).x).toBeGreaterThan(ball.x + 60);
    expect(kickSpot(ball, 1, 170).x).toBeLessThan(kickSpot(ball, 1, 94).x); // крупный встаёт дальше
    expect(inHall(kickSpot({ x: HALL.x0 + 20, y: 1250 }, 1, 170))).toBe(true);
  });

  it('ballWatch: в зале, не дальше r, не ближе 45° к линии полёта ни спереди, ни сзади', () => {
    const rnd = lcg(9);
    for (let k = 0; k < 300; k++) {
      const ball = { x: 920 + rnd() * 960, y: HALL.y0 + rnd() * (HALL.y1 - HALL.y0) };
      const from = roamPoint(rnd);
      const dir = rnd() < 0.5 ? 1 : -1;
      const r = 150 + rnd() * 70;
      const p = ballWatch(from, ball, dir, r);
      expect(inHall(p)).toBe(true);
      expect(dist(p, ball)).toBeLessThanOrEqual(r + 1e-6);
      expect(dist(p, ball)).toBeGreaterThanOrEqual(139); // не меньше ≈140: зал глубиной 280, сторона с местом
      const a = angle(p, ball, dir);
      expect(a).toBeGreaterThanOrEqual(Math.PI / 4 - 1e-6);
      expect(a).toBeLessThanOrEqual((3 * Math.PI) / 4 + 1e-6);
    }
  });

  it('ballWatch: подбегает со своей стороны, у края зала — с той, где есть место', () => {
    const mid = { x: 1400, y: 1270 };
    expect(ballWatch({ x: 1400, y: 1400 }, mid, 1, 120).y).toBeGreaterThan(mid.y);
    expect(ballWatch({ x: 1400, y: 1140 }, mid, 1, 120).y).toBeLessThan(mid.y);
    const back = { x: 1400, y: HALL.y0 + 10 };
    const p = ballWatch({ x: 1400, y: HALL.y0 }, back, 1, 180);
    expect(p.y).toBeGreaterThan(back.y);
    expect(dist(p, back)).toBeCloseTo(180);
  });
});

describe('gameMs', () => {
  const six = [
    Array(6).fill(120), Array(6).fill(230), [120, 230, 120, 230, 230, 120], [230, 230, 120, 120, 230, 230],
    Array(6).fill(94), Array(6).fill(170),
  ];

  it('при 6 питомцах любая игра 6…16 с, догонялки 10…16 с', () => {
    for (const sizes of six) {
      for (const game of GAMES) {
        const ms = gameMs(game, sizes);
        expect(ms).toBeGreaterThanOrEqual(game === 'chase' ? 10_000 : 6_000);
        expect(ms).toBeLessThanOrEqual(16_000);
      }
    }
  });

  it('меньше двух здоровых — Infinity: Hall такие игры пропускает', () => {
    for (const game of GAMES) {
      expect(gameMs(game, [])).toBe(Infinity);
      expect(gameMs(game, [120])).toBe(Infinity);
      expect(gameMs(game, [120, 120])).toBeLessThan(16_000);
    }
  });

  it('бюджет — путь / скорость + сбор и радость', () => {
    expect(gameMs('chase', [120, 120])).toBeCloseTo(TIMING.gather + (CHASE_LAPS * pathLength(ringLoop())) / RUN + TIMING.joy);
    expect(gameMs('train', [120, 120])).toBeCloseTo(TIMING.gather + pathLength(trainLoop()) / TRAIN + TIMING.joy);
  });
});

describe('gamesFor', () => {
  it('без reduced — мяч, паровозик и чехарда по разу в случайном порядке; с reduced — без чехарды', () => {
    const rnd = lcg(3);
    const orders = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const g = gamesFor(false, rnd);
      expect([...g].sort()).toEqual(['ball', 'leap', 'train']);
      orders.add(g.join());
      expect([...gamesFor(true, rnd)].sort()).toEqual(['ball', 'train']);
    }
    expect(orders.size).toBe(6);
  });
});
