import { describe, expect, it } from 'vitest';
import { CATALOG, PLACES, VACATION_AT, itemByCode, shopState, type Place } from './shop';
import type { Override } from './pet';
import type { DateStr } from './types';

const START: DateStr = '2026-11-02';
const buy = (date: DateStr, code: number) => ({ date, kind: 'buy' as Override['kind'], delta: code });
const vac = (date: DateStr, on: 0 | 1) => ({ date, kind: 'vacation' as Override['kind'], delta: on });
/** Монет сколько угодно: 100 оплат на план в 1 оплату. */
const rich = (overrides: ReturnType<typeof buy>[], asOf: DateStr = '2026-11-20') =>
  shopState({ paymentsByDay: { [START]: 100 }, gameCents: 100, startDate: START, asOf, overrides });

describe('каталог магазина', () => {
  it('25 вещей, коды 1..25 по порядку, id уникальны, места и цены — таблица спеки', () => {
    expect(CATALOG.map((i) => i.code)).toEqual(Array.from({ length: 25 }, (_, k) => k + 1));
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(25);
    expect(CATALOG.map((i) => [i.id, i.place, i.price])).toEqual([
      ['desk-office', 'desk', 8], ['desk-wood', 'desk', 10], ['desk-gaming', 'desk', 15],
      ['pc-crt', 'pc', 12], ['pc-laptop', 'pc', 15], ['pc-dual', 'pc', 20],
      ['phone-rotary', 'phone', 10], ['phone-office', 'phone', 10],
      ['chair-office', 'chair', 6], ['chair-beanbag', 'chair', 8], ['chair-fitball', 'chair', 5],
      ['corner-ficus', 'corner', 5], ['corner-cactus', 'corner', 4], ['corner-cooler', 'corner', 10], ['corner-coffee', 'corner', 12],
      ['rug-round', 'rug', 3], ['rug-striped', 'rug', 3], ['rug-paw', 'rug', 4],
      ['wall-clock', 'wallL', 4], ['wall-poster', 'wallL', 4], ['wall-chart', 'wallL', 6],
      ['wall-diploma', 'wallR', 5], ['wall-trophies', 'wallR', 8],
      ['window-garland', 'window', 4], ['window-flowers', 'window', 4],
    ]);
    expect(itemByCode(6)?.name).toBe('Два монитора');
    expect(itemByCode(0)).toBeUndefined();
  });

  it('рабочий угол стоит 30, самая дорогая обстановка всех мест — 87', () => {
    const min = (p: Place) => Math.min(...CATALOG.filter((i) => i.place === p).map((i) => i.price));
    const max = (p: Place) => Math.max(...CATALOG.filter((i) => i.place === p).map((i) => i.price));
    expect(min('desk') + min('pc') + min('phone')).toBe(30);
    expect(PLACES.reduce((s, p) => s + max(p), 0)).toBe(87);
    expect(PLACES).toEqual(['desk', 'pc', 'phone', 'chair', 'corner', 'rug', 'wallL', 'wallR', 'window']);
    expect(VACATION_AT).toBe(100);
  });
});

describe('монеты: 1% плана группы на игру = 1 монета', () => {
  it('процент плана по оплатам с начала игры по asOf; после asOf и до старта не считаются', () => {
    const s = shopState({
      paymentsByDay: { '2026-11-01': 7, '2026-11-02': 3, '2026-11-05': 2, '2026-11-06': 9 },
      gameCents: 2000, startDate: START, asOf: '2026-11-05', overrides: [],
    });
    expect(s.coins).toBe(25);
    expect(s.balance).toBe(25);
    expect(s.today).toBe(2);
  });

  it('группы 4 и 10 человек с одинаковым процентом плана получают одинаково', () => {
    const small = shopState({ paymentsByDay: { [START]: 4 }, gameCents: 1000, startDate: START, asOf: START, overrides: [] });
    const big = shopState({ paymentsByDay: { [START]: 10 }, gameCents: 2500, startDate: START, asOf: START, overrides: [] });
    expect(small.coins).toBe(40);
    expect(big.coins).toBe(40);
  });

  it('без плана монет нет', () => {
    expect(shopState({ paymentsByDay: { [START]: 5 }, gameCents: 0, startDate: START, asOf: START, overrides: [] }).coins).toBe(0);
  });
});

describe('покупки при пересчёте', () => {
  it('покупка сверх монет засчитана, баланс уходит в минус', () => {
    const s = shopState({ paymentsByDay: { [START]: 1 }, gameCents: 1000, startDate: START, asOf: START, overrides: [buy(START, 1), buy(START, 4)] });
    expect(s.coins).toBe(10);
    expect(s.owned).toEqual({ desk: 'desk-office', pc: 'pc-crt' });
    expect(s.spent).toBe(20);
    expect(s.balance).toBe(-10);
  });

  it('компьютер без стола не засчитан и монеты не тратит; после стола — можно', () => {
    expect(rich([buy(START, 4), buy(START, 1)])).toMatchObject({ owned: { desk: 'desk-office' }, spent: 8 });
    expect(rich([buy(START, 4), buy(START, 1), buy(START, 4)])).toMatchObject({ owned: { desk: 'desk-office', pc: 'pc-crt' }, spent: 20 });
    expect(rich([buy(START, 7)])).toMatchObject({ owned: {}, spent: 0 });
  });

  it('повторная покупка той же вещи не тратит монеты', () => {
    expect(rich([buy(START, 1), buy(START, 1)]).spent).toBe(8);
  });

  it('новая вещь на занятом месте заменяет старую; компьютер остаётся на новом столе', () => {
    expect(rich([buy(START, 1), buy(START, 4), buy(START, 2)])).toMatchObject({
      owned: { desk: 'desk-wood', pc: 'pc-crt' }, spent: 30,
    });
  });

  it('неизвестный код пропускается', () => {
    expect(rich([buy(START, 0), buy(START, 26), buy(START, 3.5)])).toMatchObject({ owned: {}, spent: 0 });
  });

  it('запись после asOf не считается', () => {
    expect(rich([buy(START, 1), buy('2026-11-21', 2)], '2026-11-20').owned).toEqual({ desk: 'desk-office' });
  });

  it('покупки не зависят от монет: при вдвое большем плане те же вещи и траты', () => {
    const list = [buy(START, 3), buy(START, 6), buy(START, 8), buy(START, 15)];
    const a = shopState({ paymentsByDay: { [START]: 10 }, gameCents: 1000, startDate: START, asOf: START, overrides: list });
    const b = shopState({ paymentsByDay: { [START]: 10 }, gameCents: 2000, startDate: START, asOf: START, overrides: list });
    expect(b.owned).toEqual(a.owned);
    expect(b.spent).toBe(a.spent);
    expect(a.spent).toBe(15 + 20 + 10 + 12);
  });

  it('прочие записи журнала (кучки, расходы РГ) магазин не трогают', () => {
    const s = rich([{ date: START, kind: 'useToy', delta: 1 }, { date: START, kind: 'piles', delta: 2 }]);
    expect(s).toMatchObject({ owned: {}, spent: 0, vacation: false });
  });
});

describe('отпуск', () => {
  it('решает последняя запись, процент при пересчёте не проверяется', () => {
    const none = shopState({ paymentsByDay: {}, gameCents: 1000, startDate: START, asOf: START, overrides: [] });
    expect(none.vacation).toBe(false);
    const on = shopState({ paymentsByDay: {}, gameCents: 1000, startDate: START, asOf: START, overrides: [vac(START, 1)] });
    expect(on.coins).toBe(0);
    expect(on.vacation).toBe(true);
    expect(rich([vac(START, 1), vac(START, 0)]).vacation).toBe(false);
    expect(rich([vac(START, 1), vac('2026-11-21', 0)], '2026-11-20').vacation).toBe(true);
  });
});
