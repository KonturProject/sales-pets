import { describe, expect, test } from 'vitest';
import { THEME } from '@/art/manifest';
import type { PetState } from '@/engine/pet';
import { GROUPS, type GroupCode } from '@/engine/types';
import { careRooms, growthMoments, MAX_MOMENTS } from './moments';

const pet = (o: Partial<PetState> = {}): PetState => ({
  alive: true, generation: 1, totalPayments: 0, phase: 'egg0', stage: 0, planPercent: null,
  medkits: 0, toys: 0, piles: 0, mood: 'ok', satiety: 0, noPayDays: 0, ...o,
});
const all = (o: Partial<Record<GroupCode, Partial<PetState>>> = {}) =>
  Object.fromEntries(GROUPS.map((g) => [g, pet(o[g])])) as Record<GroupCode, PetState>;

describe('growthMoments: крупный план комнаты при вылуплении и росте', () => {
  test('первое обновление (прошлого нет) — моментов нет: загрузка экрана не устраивает показ', () => {
    expect(growthMoments(null, all({ СР1: { phase: 'pet', stage: 3 } }))).toEqual([]);
  });

  test('вылупление открывает вид питомца, рост называет стадию; порядок групп как на экране', () => {
    const prev = all({ СР1: { phase: 'pet', stage: 2 }, СР2: { phase: 'egg2' } });
    const now = all({ СР1: { phase: 'pet', stage: 3 }, СР2: { phase: 'pet', stage: 1 } });
    expect(growthMoments(prev, now)).toEqual([
      { group: 'СР1', text: 'Питомец СР1 подрос: стадия 3 из 5' },
      { group: 'СР2', text: `СР2: вылупился ${THEME['СР2'].species}!` },
    ]);
  });

  test('понижение стадии (правка в админке), гибель и новое яйцо — не повод для показа', () => {
    const prev = all({ СР1: { phase: 'pet', stage: 3 }, СР3: { phase: 'pet', stage: 2 }, СР5: { phase: 'pet', stage: 4 } });
    const now = all({
      СР1: { phase: 'pet', stage: 2 },
      СР3: { phase: 'pet', stage: 3, alive: false, mood: 'dead' },
      СР5: { phase: 'egg0', stage: 0, generation: 2 },
    });
    expect(growthMoments(prev, now)).toEqual([]);
  });

  test('массовый импорт оплат: показов не больше трёх, цикл не застревает', () => {
    const now = all(Object.fromEntries(GROUPS.map((g) => [g, { phase: 'pet', stage: 1 }])));
    expect(growthMoments(all(), now)).toHaveLength(MAX_MOMENTS);
    expect(MAX_MOMENTS).toBe(3);
  });
});

describe('careRooms: кому из питомцев нужна помощь РГ', () => {
  test('болеет — аптечка, грустит и скучает — игрушка; больные первыми; яйца и погибшие не в счёт', () => {
    const s = all({
      СР1: { phase: 'pet', stage: 2, mood: 'bored' },
      СР3: { phase: 'egg1', mood: 'sad' },
      СР5: { phase: 'pet', stage: 4, mood: 'sick' },
      СР6: { phase: 'pet', stage: 2, mood: 'sad' },
      СР9: { phase: 'pet', stage: 2, mood: 'dead', alive: false },
    });
    expect(careRooms(s)).toEqual([
      { group: 'СР5', text: 'Питомец СР5 болеет — нужна аптечка' },
      { group: 'СР1', text: 'Питомец СР1 скучает — нужна игрушка' },
      { group: 'СР6', text: 'Питомец СР6 грустит — нужна игрушка' },
    ]);
  });

  test('все здоровы — визитов нет', () => {
    expect(careRooms(all({ СР1: { phase: 'pet', stage: 3 } }))).toEqual([]);
  });
});
