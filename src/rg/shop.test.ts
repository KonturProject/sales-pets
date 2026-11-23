import { describe, expect, test } from 'vitest';
import { PLACES, itemByCode, type ShopState } from '@/engine/shop';
import { coinsWord, confirmText, purchaseError, shopCards, vacationBlock } from './shop';

const shop = (o: Partial<ShopState> = {}): ShopState => ({ coins: 50, granted: 0, spent: 0, balance: 50, owned: {}, vacation: false, today: 0, ...o });
const card = (s: ShopState, code: number) => shopCards(s).flatMap((g) => g.cards).find((c) => c.item.code === code)!;

describe('карточки магазина РГ', () => {
  test('группы по местам в порядке показа, внутри — по коду, все 25 вещей', () => {
    const groups = shopCards(shop());
    expect(groups.map((g) => g.place)).toEqual(PLACES);
    expect(groups[0]).toMatchObject({ place: 'desk', title: 'Стол' });
    expect(groups[0]!.cards.map((c) => c.item.code)).toEqual([1, 2, 3]);
    expect(groups.flatMap((g) => g.cards)).toHaveLength(25);
  });

  test('состояния: купить, стоит у вас, сначала стол, не хватает', () => {
    const s = shop({ balance: 10, owned: { desk: 'desk-office' } });
    expect(card(s, 1)).toMatchObject({ state: 'owned' });
    expect(card(s, 2)).toMatchObject({ state: 'buy' });
    expect(card(s, 3)).toMatchObject({ state: 'short', short: 5 });
    expect(card(s, 7)).toMatchObject({ state: 'buy' });
    expect(card(shop(), 4)).toMatchObject({ state: 'needDesk' });
    expect(card(shop(), 8)).toMatchObject({ state: 'needDesk' });
  });

  test('отрицательный баланс считается нулём: стол за 8 — не хватает 8', () => {
    expect(card(shop({ balance: -10 }), 1)).toMatchObject({ state: 'short', short: 8 });
    expect(card(shop({ balance: 0 }), 16)).toMatchObject({ state: 'short', short: 3 });
  });
});

describe('тексты магазина РГ', () => {
  test('подтверждение называет вещь, цену и что она заменит', () => {
    const wood = itemByCode(2)!;
    expect(confirmText(wood, shop({ owned: { desk: 'desk-office' } }))).toBe('Купить «Деревянный стол» за 10 монет вместо «Офисный стол»?');
    expect(confirmText(wood, shop())).toBe('Купить «Деревянный стол» за 10 монет?');
    expect(confirmText(itemByCode(23)!, shop({ owned: { wallR: 'wall-diploma' } }))).toBe('Купить «Полка с кубками» за 8 монет вместо «Грамота «Лучший продавец»»?');
    expect(confirmText(itemByCode(19)!, shop())).toBe('Купить «Часы» за 4 монеты?');
  });

  test('монета, монеты, монет', () => {
    expect([1, 3, 4, 5, 11, 14, 21, 22, 25].map(coinsWord)).toEqual(['монета', 'монеты', 'монеты', 'монет', 'монет', 'монет', 'монета', 'монеты', 'монет']);
  });

  test('отказ сервера — понятная ошибка покупки', () => {
    expect(purchaseError('bad_request')).toBe('Сервер не принял покупку: обновите страницу или попробуйте позже');
  });
});

describe('отпуск группы', () => {
  test('до 100% плана — сколько осталось, кнопки нет', () => {
    expect(vacationBlock(shop({ coins: 45 }))).toEqual({ line: 'До отпуска: 45% из 100%', action: null, confirm: null });
    expect(vacationBlock(shop({ coins: 99, balance: 0 }))).toMatchObject({ action: null });
    // монеты от админа порог не двигают: считается только заработанное
    expect(vacationBlock(shop({ coins: 60, granted: 50, balance: 110 }))).toEqual({ line: 'До отпуска: 60% из 100%', action: null, confirm: null });
  });

  test('со 100% плана — «в отпуск» с подтверждением, траты не мешают', () => {
    expect(vacationBlock(shop({ coins: 100, balance: 3 }))).toEqual({
      line: 'План выполнен на 100%: группа может уйти в отпуск',
      action: 'go',
      confirm: 'Отправить группу в отпуск? Комната на ТВ станет пляжем, мебель дождётся возвращения.',
    });
  });

  test('в отпуске — «вернуть» с подтверждением', () => {
    expect(vacationBlock(shop({ coins: 120, vacation: true }))).toEqual({ line: 'Группа в отпуске', action: 'back', confirm: 'Вернуть группу из отпуска?' });
  });
});
