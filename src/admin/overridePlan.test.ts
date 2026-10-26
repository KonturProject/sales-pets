import { describe, expect, test } from 'vitest';
import type { PetState } from '@/engine/pet';
import { overrideDelta, parseAmount, splitDelta } from './overridePlan';

const state = (over: Partial<PetState> = {}): PetState => ({
  alive: true, generation: 0, totalPayments: 12, phase: 'pet', stage: 2, medkits: 2, toys: 3, piles: 4, mood: 'ok', satiety: 0.5,
  ...over,
});

describe('overrideDelta', () => {
  test('выдать — ровно столько, сколько введено, состояние не важно', () => {
    expect(overrideDelta('toys', 'give', 3, state())).toBe(3);
    expect(overrideDelta('piles', 'give', 1, state({ piles: 5 }))).toBe(1);
  });

  test('сбросить — минус текущее число выбранного вида', () => {
    expect(overrideDelta('piles', 'reset', 0, state())).toBe(-4);
    expect(overrideDelta('medkits', 'reset', 0, state())).toBe(-2);
    expect(overrideDelta('toys', 'reset', 0, state())).toBe(-3);
  });

  test('сбрасывать нечего — 0', () => {
    expect(overrideDelta('piles', 'reset', 0, state({ piles: 0 }))).toBe(0);
  });
});

describe('parseAmount', () => {
  test('целое от 1 до 20, пробелы не мешают', () => {
    expect(parseAmount('3')).toBe(3);
    expect(parseAmount(' 20 ')).toBe(20);
  });

  test('ноль, минус, дробь, пусто, мусор и больше 20 — ошибка', () => {
    for (const bad of ['0', '-1', '2.5', '', 'abc', '21']) {
      expect(parseAmount(bad), JSON.stringify(bad)).toHaveProperty('error');
    }
  });
});

describe('splitDelta', () => {
  test('правка до 20 по модулю уходит одной', () => {
    expect(splitDelta(7)).toEqual([7]);
    expect(splitDelta(-20)).toEqual([-20]);
  });

  test('больше 20 по модулю делится на части по 20 с остатком, знак сохраняется', () => {
    expect(splitDelta(-45)).toEqual([-20, -20, -5]);
    expect(splitDelta(41)).toEqual([20, 20, 1]);
  });
});
