import { describe, expect, test } from 'vitest';
import { HOME_MS } from './Hall';
import { careTurn, CYCLE_MS, MIN_WALK_MS, PASS, PASSES_PER_WALK, shotAt, WALK_MS, walkFor } from './schedule';

const LAP = 55_000;
const WALK_AT = PASSES_PER_WALK * LAP;

describe('цикл камеры: четыре круга (комнаты 25 с → герои 12 с → группа 18 с), потом прогулка 80 с', () => {
  test('константы цикла сходятся', () => {
    expect(PASS).toEqual([['rooms', 25_000], ['heroes', 12_000], ['group', 18_000]]);
    expect(PASSES_PER_WALK).toBe(4);
    expect(WALK_MS).toBe(80_000);
    expect(CYCLE_MS).toBe(4 * 55_000 + WALK_MS);
  });
});

describe('shotAt', () => {
  test('начало цикла — комнаты, слайд правой доски 0', () => {
    expect(shotAt(0)).toEqual({ shot: 'rooms', slide: 0, at: 0 });
    expect(shotAt(24_999)).toEqual({ shot: 'rooms', slide: 0, at: 24_999 });
  });

  test('после комнат — доска героев', () => {
    expect(shotAt(25_000)).toEqual({ shot: 'heroes', slide: 0, at: 0 });
  });

  test('на доске группы слайд меняется каждые 6 с', () => {
    expect(shotAt(37_000)).toEqual({ shot: 'group', slide: 0, at: 0 });
    expect(shotAt(43_000)).toEqual({ shot: 'group', slide: 1, at: 6_000 });
    expect(shotAt(49_000)).toEqual({ shot: 'group', slide: 2, at: 12_000 });
  });

  test('второй круг — снова комнаты, слайды правой доски продолжаются (3, 4, 5)', () => {
    expect(shotAt(55_000)).toEqual({ shot: 'rooms', slide: 3, at: 0 });
    expect(shotAt(55_000 + 37_000)).toEqual({ shot: 'group', slide: 3, at: 0 });
    expect(shotAt(55_000 + 49_000)).toEqual({ shot: 'group', slide: 5, at: 12_000 });
  });

  test('после четвёртого круга — прогулка 80 с', () => {
    expect(shotAt(WALK_AT - 1)).toMatchObject({ shot: 'group' });
    expect(shotAt(220_000)).toMatchObject({ shot: 'walk', at: 0 });
    expect(shotAt(299_999)).toMatchObject({ shot: 'walk', at: 79_999 });
  });

  test('следующий цикл продолжает слайды сквозной нумерацией кругов', () => {
    expect(shotAt(300_000)).toEqual({ shot: 'rooms', slide: 12, at: 0 });
    expect(shotAt(300_000 + 37_000)).toEqual({ shot: 'group', slide: 12, at: 0 });
  });

  test('at — сколько прошло внутри кадра: по нему комнаты делятся на общий план и визиты заботы', () => {
    expect(shotAt(13_500).at).toBe(13_500);
    expect(shotAt(LAP + 26_000).at).toBe(1_000);
  });

  test('отрицательное время и NaN не бросают — начало цикла', () => {
    expect(shotAt(-5)).toEqual({ shot: 'rooms', slide: 0, at: 0 });
    expect(shotAt(Number.NaN)).toEqual({ shot: 'rooms', slide: 0, at: 0 });
  });
});

describe('walkFor: сколько гулять, если кадр «прогулка» застали в момент at (после удержания доски)', () => {
  test('с начала кадра — весь кадр без секунды на переход к комнатам', () => {
    expect(walkFor(0)).toBe(WALK_MS - 1_000);
  });

  test('удержание съело начало — только остаток кадра, питомцы успевают домой до смены кадра', () => {
    expect(walkFor(15_000)).toBe(WALK_MS - 15_000 - 1_000);
  });

  test('застали под конец — прогулку не начинаем', () => {
    expect(walkFor(WALK_MS - MIN_WALK_MS)).toBeGreaterThan(0);
    expect(walkFor(WALK_MS - MIN_WALK_MS + 1)).toBe(0);
  });

  test('самая короткая поздняя прогулка: до ухода домой успевают выйти (~7 с) и побродить', () => {
    expect(walkFor(WALK_MS - MIN_WALK_MS) - HOME_MS).toBeGreaterThanOrEqual(9_000);
  });
});

describe('careTurn: визиты заботы с 12 с кадра «комнаты» нумеруются подряд через все круги', () => {
  test('до 12 с кадра и в других кадрах визитов нет', () => {
    expect(careTurn(11_999)).toBeNull();
    expect(careTurn(25_000)).toBeNull();
  });

  test('два визита по 6,5 с за круг, каждый следующий круг (и в том же цикле) продолжает счёт', () => {
    const at = [12_000, 18_499, 18_500, 24_999, LAP + 12_000, LAP + 18_500, 3 * LAP + 12_000, CYCLE_MS + 12_000, 2 * CYCLE_MS + 18_500];
    expect(at.map(careTurn)).toEqual([0, 0, 1, 1, 2, 3, 6, 8, 17]);
  });

  test('в кадре прогулки визитов нет', () => {
    expect(careTurn(WALK_AT)).toBeNull();
    expect(careTurn(WALK_AT + 12_000)).toBeNull();
  });
});
