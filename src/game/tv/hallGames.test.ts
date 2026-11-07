import { describe, expect, it } from 'vitest';
import {
  CHASE_LAPS, HALL, KICK_MAX, KICK_MIN, RUN, TIMING, TRAIN, ballSpot, gameMs, gamesFor, headingAt, leapPlan, loopPath,
  pathLength, pointAt, ringLoop, roamPoint, trainLoop, type Game, type Pt,
} from './hallGames';

/** Детерминированный генератор (LCG) для серий случайных вызовов. */
const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const SCALE = 1.55;
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
