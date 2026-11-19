import { describe, expect, test } from 'vitest';
import type { PetState } from '@/engine/pet';
import type { ShopState } from '@/engine/shop';
import { canCall } from './calls';
import { showBeach } from './beach';

const pet = (o: Partial<PetState> = {}): PetState => ({
  alive: true, generation: 0, totalPayments: 30, phase: 'pet', stage: 3, planPercent: 100,
  medkits: 0, toys: 0, piles: 0, mood: 'ok', satiety: 0.5, noPayDays: 0, ...o,
});
const shop = (o: Partial<ShopState> = {}): ShopState => ({
  coins: 100, spent: 18, balance: 82, owned: { desk: 'desk-office', phone: 'phone-office' }, vacation: true, today: 2, ...o,
});

describe('отпуск на ТВ', () => {
  test('пляж только у живого вылупившегося питомца группы в отпуске', () => {
    expect(showBeach(pet(), shop())).toBe(true);
    expect(showBeach(pet({ mood: 'sick' }), shop())).toBe(true);
    expect(showBeach(pet(), shop({ vacation: false }))).toBe(false);
    expect(showBeach(pet(), null)).toBe(false);
    expect(showBeach(pet({ alive: false, mood: 'dead' }), shop())).toBe(false);
    expect(showBeach(pet({ phase: 'egg2', stage: 0 }), shop())).toBe(false);
  });

  test('в отпуске телефон молчит', () => {
    expect(canCall(pet(), shop())).toBe(false);
    expect(canCall(pet(), shop({ vacation: false }))).toBe(true);
  });
});
