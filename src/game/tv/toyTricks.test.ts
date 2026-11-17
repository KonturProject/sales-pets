import { describe, expect, it } from 'vitest';
import { BALL_EDGE } from './ball';
import { CEIL, PHONE, TRICKS, head, isTrick, paw, type TrickGeo, type TrickPlay } from './toyTricks';
import { TOYS, toyHeight } from './toys';

const ROOM_W = 529;
const PET_EDGE = 70;
const PLAYS = Object.keys(TRICKS) as TrickPlay[];
const FLYING: TrickPlay[] = ['glide', 'drive', 'hop'];

/** Питомец стоит у игрушки со стороны `-dir` (как в `PetActor.wander`), но не ближе `PET_EDGE` к стене. */
const geo = (o: Partial<TrickGeo> = {}): TrickGeo => {
  const g = { toyX: 264, dir: 1 as const, side: 150, reach: 80, roomW: ROOM_W, petEdge: PET_EDGE, toyH: 56, rnd: () => 0.5, ...o };
  const petX = o.petX ?? Math.min(ROOM_W - PET_EDGE, Math.max(PET_EDGE, g.toyX - g.dir * g.reach));
  return { ...g, petX };
};

/**
 * Все сочетания: игрушка у левой стены, в середине, у правой; питомец слева и справа; малыш и взрослый; разный случай.
 * Рамка — настоящей высоты игрушки этого трюка (`toyHeight`).
 */
const cases = (play: TrickPlay): TrickGeo[] => {
  const toyH = toyHeight(TOYS.find((t) => t.play === play)!.kind);
  const out: TrickGeo[] = [];
  for (const toyX of [BALL_EDGE, 120, 264, 400, ROOM_W - BALL_EDGE]) {
    for (const dir of [1, -1] as const) {
      for (const side of [94, 130, 170]) {
        for (const r of [0, 0.5, 0.999]) out.push(geo({ toyX, dir, side, toyH, reach: 64 * Math.max(1, side / 120), rnd: () => r }));
      }
    }
  }
  return out;
};

describe('игры-трюки новых игрушек', () => {
  it('у каждой новой игрушки из TOYS есть трюк, у прежних пяти — нет (их игры в PetActor)', () => {
    const tricks = TOYS.filter((t) => isTrick(t.play)).map((t) => t.kind);
    expect(tricks).toEqual(['balloon', 'yoyo', 'plane', 'car', 'bubbles', 'drum', 'phone', 'bouncer', 'rocket', 'dumbbell']);
    expect(PLAYS).toHaveLength(10);
    expect(isTrick('ball')).toBe(false);
    expect(isTrick('hug')).toBe(false);
  });

  it('путь игрушки начинается на её месте и кончается на полу в endX; доли времени по порядку от 0 до 1', () => {
    for (const play of PLAYS) {
      for (const g of cases(play)) {
        const t = TRICKS[play](g);
        const label = `${play} ${JSON.stringify({ toyX: g.toyX, dir: g.dir, side: g.side })}`;
        expect(t.play, label).toBe(play);
        expect(t.keys[0], label).toMatchObject({ t: 0, x: g.toyX, up: 0 });
        expect(t.keys.at(-1), label).toMatchObject({ t: 1, x: t.endX, up: 0 });
        t.keys.forEach((k, i) => i && expect(k.t, label).toBeGreaterThanOrEqual(t.keys[i - 1]!.t));
        expect(t.ms, label).toBeGreaterThan(1500);
        expect(t.ms, label).toBeLessThanOrEqual(4000);
      }
    }
  });

  it('игрушка не вылетает из комнаты и верхом картинки не заходит на таблички (CEIL); летающие садятся на пол с отступом, как мяч', () => {
    for (const play of PLAYS) {
      for (const g of cases(play)) {
        const t = TRICKS[play](g);
        const label = `${play} ${JSON.stringify({ toyX: g.toyX, dir: g.dir, side: g.side })}`;
        for (const k of t.keys) {
          expect(k.x, label).toBeGreaterThanOrEqual(g.toyH / 2);
          expect(k.x, label).toBeLessThanOrEqual(ROOM_W - g.toyH / 2);
          expect(k.up, label).toBeGreaterThanOrEqual(0);
          expect(k.up + g.toyH, label).toBeLessThanOrEqual(CEIL); // верх картинки, а не низ: таблички комнаты выше
        }
        expect(t.endX, label).toBeGreaterThanOrEqual(Math.min(g.toyX, BALL_EDGE));
        expect(t.endX, label).toBeLessThanOrEqual(Math.max(g.toyX, ROOM_W - BALL_EDGE));
        for (const f of t.fx) {
          expect(f.up + f.rise, label).toBeLessThanOrEqual(CEIL);
          expect(f.t, label).toBeGreaterThanOrEqual(0);
          expect(f.t + f.ms / t.ms, label).toBeLessThanOrEqual(1.5);
        }
      }
    }
  });

  it('метки питомца по порядку внутри трюка; идёт он только по своему полу', () => {
    for (const play of PLAYS) {
      for (const g of cases(play)) {
        const t = TRICKS[play](g);
        const label = `${play} ${JSON.stringify({ toyX: g.toyX, dir: g.dir, side: g.side })}`;
        t.cues.forEach((c, i) => {
          expect(c.t, label).toBeGreaterThanOrEqual(i ? t.cues[i - 1]!.t : 0);
          expect(c.t, label).toBeLessThanOrEqual(1);
          if (c.do === 'walk') {
            expect(c.x, label).toBeGreaterThanOrEqual(PET_EDGE);
            expect(c.x, label).toBeLessThanOrEqual(ROOM_W - PET_EDGE);
          }
        });
      }
    }
  });

  it('самолётик, машинка и попрыгунчик улетают со своего места, остальные возвращаются на него', () => {
    for (const play of PLAYS) {
      const g = geo();
      const t = TRICKS[play](g);
      if (FLYING.includes(play)) {
        expect(Math.abs(t.endX - g.toyX), play).toBeGreaterThan(40);
        expect(t.cues.some((c) => c.do === 'walk'), `${play}: питомец идёт за игрушкой`).toBe(true);
      } else expect(t.endX, play).toBe(g.toyX);
    }
  });

  it('самолётик у стены летит туда, где есть место: питомец разворачивается', () => {
    const g = geo({ toyX: ROOM_W - BALL_EDGE, dir: 1 });
    const t = TRICKS.glide(g);
    expect(t.endX).toBeLessThan(g.petX);
    expect(t.face).toBe(-1);
    expect(t.cues).toContainEqual(expect.objectContaining({ do: 'face', dir: -1 }));
  });

  it('машинка едет к дальней стене и обратно: в конце смотрит туда, куда ехала назад', () => {
    const t = TRICKS.drive(geo({ toyX: 120 }));
    expect(Math.max(...t.keys.map((k) => k.x))).toBe(ROOM_W - BALL_EDGE);
    expect(t.endX).toBeGreaterThan(120);
    expect(t.endX).toBeLessThan(ROOM_W - BALL_EDGE);
    expect(t.face).toBe(-1);
  });

  it('йо-йо: нитка от лапы, пока игрушка в руке; крутится три раза вниз-вверх', () => {
    const g = geo();
    const t = TRICKS.yoyo(g);
    expect(t.string).toMatchObject({ up: Math.max(paw(g.side).up, 84) });
    expect(t.keys.filter((k) => k.up <= 6 && k.t > 0 && k.t < 1)).toHaveLength(3);
  });

  it('йо-йо: внизу видна нитка не короче 20 px, наверху игрушка под лапой; висит сбоку от питомца, а не за ним', () => {
    for (const g of cases('yoyo')) {
      const t = TRICKS.yoyo(g);
      const label = JSON.stringify({ toyX: g.toyX, dir: g.dir, side: g.side });
      const hung = t.keys.filter((k) => k.t > 0 && k.t < 1);
      for (const k of hung) {
        expect(k.up + g.toyH, label).toBeLessThanOrEqual(t.string!.up);
        if (k.up <= 6) expect(t.string!.up - k.up - g.toyH, label).toBeGreaterThanOrEqual(20);
      }
    }
    const g = geo();
    for (const k of TRICKS.yoyo(g).keys.filter((k) => k.t > 0 && k.t < 1)) {
      expect(Math.abs(k.x - g.petX)).toBeGreaterThanOrEqual(Math.round(0.45 * g.side));
    }
  });

  it('телефон говорит одну из реплик колл-центра; пузыри, нотки и дымок есть у своих игрушек', () => {
    for (const r of [0, 0.5, 0.999]) {
      const say = TRICKS.call(geo({ rnd: () => r })).cues.find((c) => c.do === 'say');
      expect(PHONE).toContain(say && 'text' in say ? say.text : '');
    }
    expect(TRICKS.bubbles(geo()).fx.filter((f) => f.kind === 'bubble')).toHaveLength(6);
    expect(TRICKS.drum(geo()).fx.filter((f) => f.kind === 'note')).toHaveLength(4);
    expect(TRICKS.launch(geo()).fx.some((f) => f.kind === 'smoke')).toBe(true);
    expect(TRICKS.call(geo()).fx.some((f) => f.kind === 'ring')).toBe(true);
  });

  it('лапа и голова выше у крупного питомца', () => {
    expect(paw(170).up).toBeGreaterThan(paw(94).up);
    expect(paw(170).out).toBeGreaterThan(paw(94).out);
    expect(head(170)).toBeGreaterThan(head(94));
    expect(head(170)).toBeLessThanOrEqual(CEIL);
  });
});
