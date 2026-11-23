import { describe, expect, test } from 'vitest';
import type { PetState } from '@/engine/pet';
import { describeOverride, overrideDelta, parseAmount, parseCoins, splitDelta } from './overridePlan';

const state = (over: Partial<PetState> = {}): PetState => ({
  alive: true, generation: 0, totalPayments: 12, phase: 'pet', stage: 2, planPercent: 30, medkits: 2, toys: 3, piles: 4, mood: 'ok', satiety: 0.5, noPayDays: 0,
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

describe('parseCoins', () => {
  test('целое от −100 до 100, кроме 0; минус — забрать; пробелы не мешают', () => {
    expect(parseCoins('15')).toBe(15);
    expect(parseCoins(' -5 ')).toBe(-5);
    expect(parseCoins('100')).toBe(100);
    expect(parseCoins('-100')).toBe(-100);
  });

  test('ноль, дробь, пусто, мусор и больше 100 по модулю — ошибка', () => {
    for (const bad of ['0', '-0', '2.5', '', 'abc', '101', '-101', '+5', '1e2']) {
      expect(parseCoins(bad), JSON.stringify(bad)).toHaveProperty('error');
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

describe('строка списка правок', () => {
  test('правки админа и расходы РГ — вид и дельта со знаком', () => {
    expect(describeOverride({ kind: 'piles', delta: 2 })).toEqual({ kind: 'Кучки', value: '+2' });
    expect(describeOverride({ kind: 'toys', delta: -3 })).toEqual({ kind: 'Игрушки', value: '-3' });
    expect(describeOverride({ kind: 'useToy', delta: 1 })).toEqual({ kind: 'РГ: игрушка', value: '+1' });
  });

  test('монеты от админа — «Монеты» и число со знаком', () => {
    expect(describeOverride({ kind: 'coins', delta: 15 })).toEqual({ kind: 'Монеты', value: '+15' });
    expect(describeOverride({ kind: 'coins', delta: -5 })).toEqual({ kind: 'Монеты', value: '-5' });
  });

  test('покупка РГ — название вещи, отпуск — уехал или вернулся', () => {
    expect(describeOverride({ kind: 'buy', delta: 2 })).toEqual({ kind: 'РГ: покупка', value: 'Деревянный стол' });
    expect(describeOverride({ kind: 'buy', delta: 99 })).toEqual({ kind: 'РГ: покупка', value: '?' });
    expect(describeOverride({ kind: 'vacation', delta: 1 })).toEqual({ kind: 'РГ: отпуск', value: 'уехал' });
    expect(describeOverride({ kind: 'vacation', delta: 0 })).toEqual({ kind: 'РГ: отпуск', value: 'вернулся' });
  });
});
