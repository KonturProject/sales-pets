import { CATALOG, NEEDS_DESK, PLACES, PLACE_TITLE, VACATION_AT, type Place, type ShopItem, type ShopState } from '@/engine/shop';

/** `buy` — можно купить; `owned` — уже стоит; `needDesk` — компьютер/телефон без стола; `short` — не хватает монет. */
export type CardState = 'buy' | 'owned' | 'needDesk' | 'short';
export interface Card {
  item: ShopItem;
  state: CardState;
  /** сколько монет не хватает (для `short`) */
  short: number;
}

/** Карточки магазина по местам в порядке показа. Отрицательный баланс (покупка из устаревшего снимка) считается нулём. */
export function shopCards(shop: ShopState): { place: Place; title: string; cards: Card[] }[] {
  const money = Math.max(0, shop.balance);
  return PLACES.map((place) => ({
    place,
    title: PLACE_TITLE[place],
    cards: CATALOG.filter((item) => item.place === place).map((item): Card => {
      const short = Math.max(0, item.price - money);
      const state: CardState = shop.owned[place] === item.id ? 'owned'
        : NEEDS_DESK.includes(place) && !shop.owned.desk ? 'needDesk'
        : short > 0 ? 'short' : 'buy';
      return { item, state, short: state === 'short' ? short : 0 };
    }),
  }));
}

/** 1 монета, 3 монеты, 5 монет. */
export function coinsWord(n: number): string {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return 'монета';
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'монеты' : 'монет';
}

/** Вопрос перед покупкой: вещь, цена и что она заменит на своём месте (без рода: «вместо …»). */
export function confirmText(item: ShopItem, shop: ShopState): string {
  const old = CATALOG.find((i) => i.id === shop.owned[item.place]);
  const instead = old && old.id !== item.id ? ` вместо «${old.name}»` : '';
  return `Купить «${item.name}» за ${item.price} ${coinsWord(item.price)}${instead}?`;
}

/** Ошибка покупки для РГ. `bad_request` — дневной предел или старый бэкенд без магазина. */
export function purchaseError(code: string): string {
  return code === 'bad_request' ? 'Сервер не принял покупку: обновите страницу или попробуйте позже' : 'Покупка не прошла';
}

/** Блок отпуска: монеты группы = процент плана; траты в магазине отпуску не мешают. */
export function vacationBlock(shop: ShopState): { line: string; action: 'go' | 'back' | null; confirm: string | null } {
  if (shop.vacation) return { line: 'Группа в отпуске', action: 'back', confirm: 'Вернуть группу из отпуска?' };
  if (shop.coins < VACATION_AT) return { line: `До отпуска: ${shop.coins}% из ${VACATION_AT}%`, action: null, confirm: null };
  return {
    line: `План выполнен на ${VACATION_AT}%: группа может уйти в отпуск`,
    action: 'go',
    confirm: 'Отправить группу в отпуск? Комната на ТВ станет пляжем, мебель дождётся возвращения.',
  };
}
