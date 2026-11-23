import type { Override } from './pet';
import type { DateStr } from './types';

/** Места в комнате: на каждом стоит одна вещь. Компьютер и телефон стоят на столе. */
export type Place = 'desk' | 'pc' | 'phone' | 'chair' | 'corner' | 'rug' | 'wallL' | 'wallR' | 'window';
export type ItemId =
  | 'desk-office' | 'desk-wood' | 'desk-gaming' | 'pc-crt' | 'pc-laptop' | 'pc-dual'
  | 'phone-rotary' | 'phone-office' | 'chair-office' | 'chair-beanbag' | 'chair-fitball'
  | 'corner-ficus' | 'corner-cactus' | 'corner-cooler' | 'corner-coffee' | 'rug-round' | 'rug-striped' | 'rug-paw'
  | 'wall-clock' | 'wall-poster' | 'wall-chart' | 'wall-diploma' | 'wall-trophies' | 'window-garland' | 'window-flowers';

export interface ShopItem {
  /** код в журнале (`delta` записи `buy`): постоянный, не меняется и не переиспользуется */
  code: number;
  id: ItemId;
  place: Place;
  name: string;
  price: number;
}

const row = (code: number, id: ItemId, place: Place, name: string, price: number): ShopItem => ({ code, id, place, name, price });

/** Каталог спеки `2026-11-18-rg-shop-design.md`. Цены после выпуска не меняются: покупки пересчитываются по текущим. */
export const CATALOG: readonly ShopItem[] = [
  row(1, 'desk-office', 'desk', 'Офисный стол', 8),
  row(2, 'desk-wood', 'desk', 'Деревянный стол', 10),
  row(3, 'desk-gaming', 'desk', 'Геймерский стол с подсветкой', 15),
  row(4, 'pc-crt', 'pc', 'Ламповый монитор', 12),
  row(5, 'pc-laptop', 'pc', 'Ноутбук', 15),
  row(6, 'pc-dual', 'pc', 'Два монитора', 20),
  row(7, 'phone-rotary', 'phone', 'Дисковый телефон', 10),
  row(8, 'phone-office', 'phone', 'Офисный телефон с кнопками', 10),
  row(9, 'chair-office', 'chair', 'Офисное кресло', 6),
  row(10, 'chair-beanbag', 'chair', 'Кресло-мешок', 8),
  row(11, 'chair-fitball', 'chair', 'Фитбол', 5),
  row(12, 'corner-ficus', 'corner', 'Фикус', 5),
  row(13, 'corner-cactus', 'corner', 'Кактус', 4),
  row(14, 'corner-cooler', 'corner', 'Кулер с водой', 10),
  row(15, 'corner-coffee', 'corner', 'Кофемашина', 12),
  row(16, 'rug-round', 'rug', 'Круглый коврик', 3),
  row(17, 'rug-striped', 'rug', 'Полосатый коврик', 3),
  row(18, 'rug-paw', 'rug', 'Коврик-лапка', 4),
  row(19, 'wall-clock', 'wallL', 'Часы', 4),
  row(20, 'wall-poster', 'wallL', 'Мотивационный постер', 4),
  row(21, 'wall-chart', 'wallL', 'Доска с графиком продаж', 6),
  row(22, 'wall-diploma', 'wallR', 'Грамота «Лучший продавец»', 5),
  row(23, 'wall-trophies', 'wallR', 'Полка с кубками', 8),
  row(24, 'window-garland', 'window', 'Гирлянда над окном', 4),
  row(25, 'window-flowers', 'window', 'Ящик с цветами под окном', 4),
];

/** Порядок показа мест на странице РГ. */
export const PLACES: readonly Place[] = ['desk', 'pc', 'phone', 'chair', 'corner', 'rug', 'wallL', 'wallR', 'window'];

export const PLACE_TITLE: Record<Place, string> = {
  desk: 'Стол', pc: 'Компьютер', phone: 'Телефон', chair: 'Кресло', corner: 'Угол', rug: 'Коврик',
  wallL: 'Стена слева', wallR: 'Стена справа', window: 'Окно',
};

/** Компьютер и телефон ставятся только на стол. */
export const NEEDS_DESK: readonly Place[] = ['pc', 'phone'];

/** Отпуск: процент плана группы на игру (решение владельца 18.11). Проверяет только страница РГ. */
export const VACATION_AT = 100;

export const itemByCode = (code: number): ShopItem | undefined => (Number.isInteger(code) ? CATALOG[code - 1] : undefined);

export interface ShopState {
  /** процент плана группы на игру по всем оплатам с начала игры: гибель питомца его не обнуляет */
  coins: number;
  /** монеты, выданные админом записями `coins` (может быть < 0); в `coins` и порог отпуска не входят */
  granted: number;
  spent: number;
  /** `coins + granted − spent`, может быть < 0 (покупки при пересчёте монеты не проверяют); показывать `max(0, balance)` */
  balance: number;
  owned: Partial<Record<Place, ItemId>>;
  vacation: boolean;
  /** оплаты группы за `asOf`: экран компьютера */
  today: number;
}

/**
 * Магазин группы на `asOf` — чистая функция снимка. Записи `buy` засчитываются по возрастанию `id` без проверки монет:
 * иначе правка плана или оплат задним числом убирала бы мебель (спека, «Экономика»). Отпуск — последняя запись `vacation`.
 */
export function shopState(i: {
  paymentsByDay: Record<DateStr, number>;
  gameCents: number;
  startDate: DateStr;
  asOf: DateStr;
  /** по возрастанию id */
  overrides: readonly { date: DateStr; kind: Override['kind']; delta: number }[];
}): ShopState {
  let paid = 0;
  for (const [date, n] of Object.entries(i.paymentsByDay)) if (date >= i.startDate && date <= i.asOf) paid += n;
  const coins = i.gameCents > 0 ? Math.floor((paid * 10000) / i.gameCents) : 0;

  const owned: Partial<Record<Place, ItemId>> = {};
  let spent = 0;
  let granted = 0;
  let vacation = false;
  for (const o of i.overrides) {
    if (o.date > i.asOf) continue;
    if (o.kind === 'vacation') vacation = o.delta === 1;
    if (o.kind === 'coins') granted += o.delta;
    if (o.kind !== 'buy') continue;
    const item = itemByCode(o.delta);
    if (!item || owned[item.place] === item.id) continue;
    if (NEEDS_DESK.includes(item.place) && !owned.desk) continue;
    owned[item.place] = item.id;
    spent += item.price;
  }
  return { coins, granted, spent, balance: coins + granted - spent, owned, vacation, today: i.paymentsByDay[i.asOf] ?? 0 };
}
