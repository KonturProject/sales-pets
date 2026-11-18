import type { PetState } from '@/engine/pet';
import type { ShopState } from '@/engine/shop';

/** Реплика звонка: клиент говорит в облачке у телефона, питомец — в своём. До 28 знаков, чтобы влезть в облачко. */
export interface Line { who: 'client' | 'pet'; text: string }

const K = (text: string): Line => ({ who: 'client', text });
const P = (text: string): Line => ({ who: 'pet', text });

/** Диалоги по телефону (спека магазина РГ, черновик Claude): первым говорит клиент, дальше по очереди. */
export const CALLS: readonly (readonly Line[])[] = [
  [K('Здравствуйте, хочу оплатить!'), P('Отлично! Счёт уже на почте'), K('Спасибо!'), P('Хорошего дня!')],
  [K('А скидка есть?'), P('Для вас лучшая цена!'), K('Тогда беру!')],
  [K('Я ещё подумаю…'), P('Давайте помогу решить'), K('Убедили, оплачиваю!')],
  [K('Куда платить?'), P('Ссылка в сообщении!'), K('Готово!'), P('Ура, оплата есть!')],
  [K('Перезвоните позже'), P('Во сколько удобно?'), K('В три'), P('Записал!')],
  [K('Продлеваем на год!'), P('Отличное решение!')],
  [K('Сколько стоит?'), P('Сейчас всё расскажу!'), K('Ого, недорого!')],
  [K('Можно счёт на фирму?'), P('Конечно! Уже отправил'), K('Оплатили!')],
];

/** Каждая комната звонит независимо, раз в 3–6 минут случайно, мс. */
export const CALL_EVERY = { min: 180_000, max: 360_000 } as const;

/** Когда звонить в следующий раз (`now` и результат — мс, `rnd` в [0, 1)). */
export function nextCallAt(now: number, rnd: () => number): number {
  return now + CALL_EVERY.min + Math.floor(rnd() * (CALL_EVERY.max - CALL_EVERY.min));
}

/** Звонит только живому вылупившемуся питомцу со стадии 2, не больному, с купленным телефоном и не в отпуске. */
export function canCall(s: PetState, shop: ShopState | null): boolean {
  return !!shop?.owned.phone && !shop.vacation && s.alive && s.phase === 'pet' && s.stage >= 2 && s.mood !== 'sick';
}
