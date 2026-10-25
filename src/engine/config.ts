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
  norms: Record<Level, { quality: number; long: number }>;
  /** накопленные оплаты, при которых наступает стадия 1..15 */
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
    experienced: { quality: 5, long: 3 },
    rookie1: { quality: 1, long: 0 },
    rookie2: { quality: 2, long: 1 },
  },
  // заглушки до плана продаж: 15 порогов
  stageThresholds: [6, 10, 15, 21, 28, 36, 45, 55, 66, 78, 91, 105, 120, 136, 153],
};
