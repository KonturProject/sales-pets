import { describe, expect, test } from 'vitest';
import type { PetState } from '@/engine/pet';
import type { ShopState } from '@/engine/shop';
import { CALLS, CALL_EVERY, canCall, nextCallAt } from './calls';

const K = (text: string) => ({ who: 'client', text });
const P = (text: string) => ({ who: 'pet', text });

const pet = (o: Partial<PetState> = {}): PetState => ({
  alive: true, generation: 0, totalPayments: 12, phase: 'pet', stage: 2, planPercent: 30,
  medkits: 0, toys: 0, piles: 0, mood: 'ok', satiety: 0.5, noPayDays: 0, ...o,
});
const shop = (o: Partial<ShopState> = {}): ShopState => ({
  coins: 30, spent: 18, balance: 12, owned: { desk: 'desk-office', phone: 'phone-office' }, vacation: false, today: 1, ...o,
});

describe('звонки клиентов', () => {
  test('восемь диалогов спеки дословно', () => {
    expect(CALLS).toEqual([
      [K('Здравствуйте, хочу оплатить!'), P('Отлично! Счёт уже на почте'), K('Спасибо!'), P('Хорошего дня!')],
      [K('А скидка есть?'), P('Для вас лучшая цена!'), K('Тогда беру!')],
      [K('Я ещё подумаю…'), P('Давайте помогу решить'), K('Убедили, оплачиваю!')],
      [K('Куда платить?'), P('Ссылка в сообщении!'), K('Готово!'), P('Ура, оплата есть!')],
      [K('Перезвоните позже'), P('Во сколько удобно?'), K('В три'), P('Записал!')],
      [K('Продлеваем на год!'), P('Отличное решение!')],
      [K('Сколько стоит?'), P('Сейчас всё расскажу!'), K('Ого, недорого!')],
      [K('Можно счёт на фирму?'), P('Конечно! Уже отправил'), K('Оплатили!')],
    ]);
  });

  test('реплика влезает в облачко, в диалоге 2–4 реплики, первым говорит клиент, дальше по очереди', () => {
    for (const call of CALLS) {
      expect(call.length).toBeGreaterThanOrEqual(2);
      expect(call.length).toBeLessThanOrEqual(4);
      call.forEach((line, i) => {
        expect(line.text.length, line.text).toBeLessThanOrEqual(28);
        expect(line.who).toBe(i % 2 ? 'pet' : 'client');
      });
    }
  });

  test('следующий звонок через 3–6 минут', () => {
    expect(CALL_EVERY).toEqual({ min: 180_000, max: 360_000 });
    expect(nextCallAt(0, () => 0)).toBe(180_000);
    expect(nextCallAt(0, () => 0.999)).toBeLessThan(360_000);
    expect(nextCallAt(1_000, () => 0.5)).toBe(271_000);
  });

  test('звонит здоровому вылупившемуся питомцу со стадии 2, если куплен телефон и группа не в отпуске', () => {
    expect(canCall(pet(), shop())).toBe(true);
    expect(canCall(pet(), null)).toBe(false);
    expect(canCall(pet(), shop({ owned: { desk: 'desk-wood' } }))).toBe(false);
    expect(canCall(pet({ alive: false, mood: 'dead' }), shop())).toBe(false);
    expect(canCall(pet({ phase: 'egg2', stage: 0 }), shop())).toBe(false);
    expect(canCall(pet({ stage: 1 }), shop())).toBe(false);
    expect(canCall(pet({ mood: 'sick' }), shop())).toBe(false);
    expect(canCall(pet(), shop({ vacation: true }))).toBe(false);
    expect(canCall(pet({ mood: 'sad', stage: 5 }), shop())).toBe(true);
  });
});
