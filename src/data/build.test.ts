import { describe, expect, test } from 'vitest';
import { decideReload } from './build';

const MIN = 60_000;
const NOW = 1_800_000_000_000;

describe('decideReload', () => {
  test('тот же номер сборки — перезагрузка не нужна', () => {
    expect(decideReload('a1', 'a1', null, NOW)).toBe(false);
  });

  test('новый номер, перезагрузок ещё не было — перезагружаем', () => {
    expect(decideReload('a1', 'b2', null, NOW)).toBe(true);
  });

  test('перезагрузка на этот же номер была 5 минут назад — не повторяем (защита от зацикливания)', () => {
    expect(decideReload('a1', 'b2', { build: 'b2', at: NOW - 5 * MIN }, NOW)).toBe(false);
  });

  test('перезагрузка на этот номер была 16 минут назад — можно снова', () => {
    expect(decideReload('a1', 'b2', { build: 'b2', at: NOW - 16 * MIN }, NOW)).toBe(true);
  });

  test('недавняя перезагрузка на другой номер не мешает: защита по номеру', () => {
    expect(decideReload('a1', 'c3', { build: 'b2', at: NOW - 5 * MIN }, NOW)).toBe(true);
  });

  test('ответа нет или он не разобран (null) — ничего не делаем', () => {
    expect(decideReload('a1', null, null, NOW)).toBe(false);
  });
});
