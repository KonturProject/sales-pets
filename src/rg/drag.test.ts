import { describe, expect, test } from 'vitest';
import { dragStep, inZone, MIN_DRAG, type DragState, type Rect } from './drag';

const zone: Rect = { left: 100, top: 100, right: 200, bottom: 200 };
const start = { x: 20, y: 150 };
const idle: DragState = { phase: 'idle' };

const down = (canStart = true, pointerId = 1) => ({ type: 'down', item: 'toy', pointerId, point: start, canStart }) as const;
const move = (x: number, y: number, pointerId = 1) => ({ type: 'move', pointerId, point: { x, y }, zone }) as const;
const up = (x: number, y: number, pointerId = 1) => ({ type: 'up', pointerId, point: { x, y }, zone }) as const;

/** Состояние после нажатия и серии движений. */
function after(...events: Parameters<typeof dragStep>[1][]): DragState {
  return events.reduce((state, event) => dragStep(state, event).state, idle);
}

describe('inZone', () => {
  test('границы зоны включены, снаружи — нет', () => {
    expect(inZone({ x: 100, y: 100 }, zone)).toBe(true);
    expect(inZone({ x: 200, y: 200 }, zone)).toBe(true);
    expect(inZone({ x: 150, y: 150 }, zone)).toBe(true);
    expect(inZone({ x: 99.9, y: 150 }, zone)).toBe(false);
    expect(inZone({ x: 150, y: 200.1 }, zone)).toBe(false);
  });

  test('запас расширяет зону со всех сторон', () => {
    expect(inZone({ x: 90, y: 150 }, zone, 10)).toBe(true);
    expect(inZone({ x: 89, y: 150 }, zone, 10)).toBe(false);
  });
});

describe('dragStep: начало', () => {
  test('нажатие, когда начинать нельзя (нет запаса, питомец погиб, идёт запрос), ничего не запускает', () => {
    expect(dragStep(idle, down(false)).state).toEqual({ phase: 'idle' });
  });

  test('нажатие запускает перенос, но он ещё не «взведён»', () => {
    expect(dragStep(idle, down()).state).toEqual({
      phase: 'dragging', item: 'toy', pointerId: 1, origin: start, armed: false, over: false,
    });
  });

  test('второе нажатие (другой палец) во время переноса игнорируется', () => {
    const state = after(down());
    expect(dragStep(state, down(true, 2)).state).toBe(state);
  });
});

describe('dragStep: движение', () => {
  test('смещение меньше MIN_DRAG не взводит перенос, даже над зоной', () => {
    const near = dragStep(idle, { type: 'down', item: 'toy', pointerId: 1, point: { x: 99, y: 150 }, canStart: true }).state;
    const state = dragStep(near, move(100 + MIN_DRAG - 2, 150)).state;
    expect(state).toMatchObject({ armed: false, over: false });
  });

  test('смещение на MIN_DRAG и больше взводит перенос', () => {
    expect(after(down(), move(start.x + MIN_DRAG, start.y))).toMatchObject({ armed: true, over: false });
  });

  test('над зоной — over, за зоной — снова нет; взведённость не снимается, даже если вернуться к месту нажатия', () => {
    const inside = after(down(), move(150, 150));
    expect(inside).toMatchObject({ armed: true, over: true });
    const outside = dragStep(inside, move(60, 150)).state;
    expect(outside).toMatchObject({ armed: true, over: false });
    const home = dragStep(outside, move(start.x + 1, start.y)).state;
    expect(home).toMatchObject({ armed: true, over: false });
  });

  test('первое же движение сразу в зону взводит и ставит over', () => {
    expect(after(down(), move(150, 150))).toMatchObject({ armed: true, over: true });
  });

  test('движение другого указателя игнорируется', () => {
    const state = after(down());
    expect(dragStep(state, move(150, 150, 2)).state).toBe(state);
  });

  test('движение без нажатия ничего не делает', () => {
    expect(dragStep(idle, move(150, 150)).state).toBe(idle);
  });
});

describe('dragStep: отпускание', () => {
  test('над зоной после движения — расход предмета и перенос засчитан', () => {
    const state = after(down(), move(150, 150));
    expect(dragStep(state, up(150, 150))).toEqual({ state: { phase: 'idle' }, drop: 'toy', dragged: true });
  });

  test('отпускание над зоной без движения расхода не даёт', () => {
    const state = after(down());
    expect(dragStep(state, { type: 'up', pointerId: 1, point: start, zone: { ...zone, left: 0 } })).toEqual({
      state: { phase: 'idle' }, dragged: false,
    });
  });

  test('смещение меньше MIN_DRAG в зоне — не расход и не перенос', () => {
    const near = dragStep(idle, { type: 'down', item: 'toy', pointerId: 1, point: { x: 101, y: 150 }, canStart: true }).state;
    expect(dragStep(near, up(101 + MIN_DRAG - 2, 150))).toEqual({ state: { phase: 'idle' }, dragged: false });
  });

  test('up может сам перенести за порог, если движений не было', () => {
    const state = after(down());
    expect(dragStep(state, up(150, 150))).toEqual({ state: { phase: 'idle' }, drop: 'toy', dragged: true });
  });

  test('мимо зоны — без расхода, но перенос был (клик после него гасится)', () => {
    const state = after(down(), move(60, 150));
    expect(dragStep(state, up(60, 150))).toEqual({ state: { phase: 'idle' }, dragged: true });
  });

  test('отпускание другого указателя игнорируется', () => {
    const state = after(down(), move(150, 150));
    expect(dragStep(state, up(150, 150, 2))).toEqual({ state });
  });

  test('отпускание без нажатия ничего не делает', () => {
    expect(dragStep(idle, up(150, 150))).toEqual({ state: idle });
  });
});

describe('dragStep: отмена', () => {
  test('cancel (потеря указателя, смена окна) сбрасывает без расхода', () => {
    const state = after(down(), move(150, 150));
    const result = dragStep(state, { type: 'cancel', pointerId: 1 });
    expect(result.state).toEqual({ phase: 'idle' });
    expect(result.drop).toBeUndefined();
  });

  test('cancel другого указателя игнорируется, cancel в покое ничего не делает', () => {
    const state = after(down(), move(150, 150));
    expect(dragStep(state, { type: 'cancel', pointerId: 2 })).toEqual({ state });
    expect(dragStep(idle, { type: 'cancel', pointerId: 1 })).toEqual({ state: idle });
  });
});
