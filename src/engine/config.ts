import type { DateStr, Level } from './types';

export interface Config {
  startDate: DateStr;
  endDate: DateStr;
  nonWorking: DateStr[];
  maxPiles: number;
  /** скука: оплат группы за вчерашний рабочий день меньше */
  boredomBelow: number;
  /** болезнь: рабочих дней подряд без оплат */
  sickDaysNoPay: number;
  /** болезнь: кучек строго больше */
  sickPilesAbove: number;
  /** смерть: рабочих дней подряд без оплат */
  deathDaysNoPay: number;
  /** личные нормы по уровню: воронка за день и оплат в день (дробное, до 0.01) — план группы = сумма по присутствующим */
  norms: Record<Level, { quality: number; long: number; payments: number }>;
  /** процент плана оплат группы на всю игру, с которого наступают стадии 2..5 (стадия 1 — вылупление) */
  stageThresholds: number[];
}

export const defaultConfig: Config = {
  startDate: '2026-11-02',
  endDate: '2026-11-22',
  nonWorking: ['2026-11-04', '2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15', '2026-11-21', '2026-11-22'],
  maxPiles: 5,
  boredomBelow: 1,
  sickDaysNoPay: 2,
  sickPilesAbove: 4,
  deathDaysNoPay: 5,
  norms: {
    // оплат в день — заглушки до плана продаж
    experienced: { quality: 5, long: 3, payments: 0.4 },
    rookie1: { quality: 1, long: 0, payments: 0 },
    rookie2: { quality: 2, long: 1, payments: 0.2 },
  },
  stageThresholds: [25, 50, 75, 100],
};
