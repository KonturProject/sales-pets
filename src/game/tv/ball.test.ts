import { describe, expect, it } from 'vitest';
import { BALL_EDGE, kickBall } from './ball';

const W = 529;
const MAX = W - BALL_EDGE;

/** Детерминированный генератор (LCG) для проверки на серии пинков. */
const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('kickBall', () => {
  it('обычный пинок: мяч летит от питомца вперёд', () => {
    const k = kickBall(300, 200, W, () => 0.5);
    expect(k.toss).toBe(false);
    expect(k.x).toBeGreaterThan(300);
    expect(k.x).toBeLessThanOrEqual(MAX);
  });

  it('пинок в стену: мяч отскакивает', () => {
    const k = kickBall(400, 350, W, () => 1);
    expect(k.toss).toBe(false);
    expect(k.x).toBe(378);
  });

  it('мяч в углу: питомец перекидывает его через себя (слева и зеркально справа)', () => {
    const left = kickBall(55, 113, W, () => 0.5);
    expect(left.toss).toBe(true);
    expect(left.x).toBeGreaterThan(113 + 100);

    const right = kickBall(W - 55, W - 113, W, () => 0.5);
    expect(right.toss).toBe(true);
    expect(right.x).toBeLessThan(W - 113 - 100);
  });

  it('поворот мяча растёт на смещение × 2.2', () => {
    const k = kickBall(300, 200, W, () => 0.5);
    expect(k.rot).toBeCloseTo((k.x - 300) * 2.2);
  });

  it('серия пинков: мяч не выходит из комнаты и не застревает у стены', () => {
    const rnd = lcg(7);
    let ball = 150;
    let wasNear = false;
    for (let i = 0; i < 500; i++) {
      // питомец где-то бродил и подходит к мячу со своей стороны
      const pet = 70 + rnd() * (W - 140);
      const dir = ball > pet ? 1 : -1;
      const k = kickBall(ball, ball - dir * 58, W, rnd);
      expect(k.x).toBeGreaterThanOrEqual(BALL_EDGE);
      expect(k.x).toBeLessThanOrEqual(MAX);
      ball = k.x;
      const near = ball - BALL_EDGE < 60 || MAX - ball < 60;
      expect(wasNear && near).toBe(false);
      wasNear = near;
    }
  });
});
