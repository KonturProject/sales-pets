import { describe, expect, test } from 'vitest';
import { DOCK_H, HUD_H, roomCamera, roomRect, STAGE, WORLD } from './layout';

describe('roomCamera: крупный план комнаты', () => {
  test.each([0, 1, 2, 3, 4, 5])('комната %i в центре кадра между верхней строкой и нижней панелью, мир без пустых полос', (i) => {
    const { x, y, s } = roomCamera(i);
    const r = roomRect(i);
    expect((r.x + r.w / 2) * s + x).toBeCloseTo(STAGE.w / 2);
    expect(r.y * s + y).toBeGreaterThanOrEqual(HUD_H);
    expect((r.y + r.h) * s + y).toBeLessThanOrEqual(STAGE.h - DOCK_H);
    expect(x).toBeLessThanOrEqual(0);
    expect(WORLD.w * s + x).toBeGreaterThanOrEqual(STAGE.w);
    expect(y).toBeLessThanOrEqual(HUD_H);
    expect(WORLD.h * s + y).toBeGreaterThanOrEqual(STAGE.h);
  });
});
