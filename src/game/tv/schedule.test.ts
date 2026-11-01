import { describe, expect, test } from 'vitest';
import { shotAt } from './schedule';

describe('shotAt: цикл камеры на стене (комнаты 25 с → герои 12 с → группа 18 с → прогулка 30 с)', () => {
  test('начало цикла — комнаты, слайд правой доски 0', () => {
    expect(shotAt(0)).toEqual({ shot: 'rooms', slide: 0 });
    expect(shotAt(24_999)).toEqual({ shot: 'rooms', slide: 0 });
  });

  test('после комнат — доска героев', () => {
    expect(shotAt(25_000)).toEqual({ shot: 'heroes', slide: 0 });
  });

  test('на доске группы слайд меняется каждые 6 с', () => {
    expect(shotAt(37_000)).toEqual({ shot: 'group', slide: 0 });
    expect(shotAt(43_000)).toEqual({ shot: 'group', slide: 1 });
    expect(shotAt(49_000)).toEqual({ shot: 'group', slide: 2 });
  });

  test('после доски группы — прогулка в зале', () => {
    expect(shotAt(55_000)).toEqual({ shot: 'walk', slide: 0 });
    expect(shotAt(84_999)).toEqual({ shot: 'walk', slide: 0 });
  });

  test('следующий проход продолжает слайды с того места, где остановился', () => {
    expect(shotAt(85_000)).toEqual({ shot: 'rooms', slide: 3 });
    expect(shotAt(85_000 + 37_000)).toEqual({ shot: 'group', slide: 3 });
  });

  test('отрицательное время и NaN не бросают — начало цикла', () => {
    expect(shotAt(-5)).toEqual({ shot: 'rooms', slide: 0 });
    expect(shotAt(Number.NaN)).toEqual({ shot: 'rooms', slide: 0 });
  });
});
