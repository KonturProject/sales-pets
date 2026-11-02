import { describe, expect, test } from 'vitest';
import { MIN_WALK_MS, shotAt, WALK_MS, walkFor } from './schedule';

describe('shotAt: цикл камеры на стене (комнаты 25 с → герои 12 с → группа 18 с → прогулка 30 с)', () => {
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

  test('после доски группы — прогулка в зале', () => {
    expect(shotAt(55_000)).toEqual({ shot: 'walk', slide: 0, at: 0 });
    expect(shotAt(84_999)).toEqual({ shot: 'walk', slide: 0, at: 29_999 });
  });

  test('следующий проход продолжает слайды с того места, где остановился', () => {
    expect(shotAt(85_000)).toEqual({ shot: 'rooms', slide: 3, at: 0 });
    expect(shotAt(85_000 + 37_000)).toEqual({ shot: 'group', slide: 3, at: 0 });
  });

  test('at — сколько прошло внутри кадра: по нему комнаты делятся на общий план и визиты заботы', () => {
    expect(shotAt(13_500).at).toBe(13_500);
    expect(shotAt(85_000 + 26_000).at).toBe(1_000);
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
});
