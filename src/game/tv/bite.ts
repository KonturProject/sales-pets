import type { GroupCode } from '@/engine/types';

/** Гуляющий в зале: `plan` — % плана оплат (`planPercent`), `sick` — больной в укусе не участвует. */
export interface Biter {
  id: GroupCode;
  plan: number | null;
  sick: boolean;
}

export interface Bite {
  biter: GroupCode;
  victim: GroupCode;
  line: 'кусь' | 'догоню!';
}

const pick = <T>(items: T[], rnd: () => number): T => items[Math.min(items.length - 1, Math.floor(rnd() * items.length))];

/**
 * Пара для укуса среди здоровых гуляющих: 50/50 «лидер кусает отстающего» («кусь») или «отстающий лидера» («догоню!»).
 * Лидер и отстающий — наибольший и наименьший план, из равных берётся случайный. Без плана или при равенстве всех — случайная пара и «кусь».
 * Меньше двух здоровых — `null`.
 */
export function pickBite(walkers: Biter[], rnd: () => number): Bite | null {
  const healthy = walkers.filter((w) => !w.sick);
  if (healthy.length < 2) return null;
  const planned = healthy.filter((w): w is Biter & { plan: number } => w.plan !== null);
  const top = Math.max(...planned.map((w) => w.plan));
  const bottom = Math.min(...planned.map((w) => w.plan));
  if (planned.length < 2 || top === bottom) {
    const biter = pick(healthy, rnd);
    const victim = pick(healthy.filter((w) => w !== biter), rnd);
    return { biter: biter.id, victim: victim.id, line: 'кусь' };
  }
  const leadFirst = rnd() < 0.5;
  const leader = pick(planned.filter((w) => w.plan === top), rnd);
  const laggard = pick(planned.filter((w) => w.plan === bottom), rnd);
  return leadFirst
    ? { biter: leader.id, victim: laggard.id, line: 'кусь' }
    : { biter: laggard.id, victim: leader.id, line: 'догоню!' };
}
