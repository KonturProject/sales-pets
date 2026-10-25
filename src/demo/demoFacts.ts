import { workingDaysBetween } from '@/engine/calendar';
import { defaultConfig, type Config } from '@/engine/config';
import { evaluateDay, type FunnelDay } from '@/engine/evaluate';
import type { GroupFacts } from '@/engine/pet';
import type { Absence, Employee } from '@/engine/staff';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';

export interface Demo {
  staff: Employee[];
  absences: Absence[];
  funnel: FunnelDay[];
  paymentsByGroup: Record<GroupCode, Record<DateStr, number>>;
  cfg: Config;
}

const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е'];

/** сколько сотрудников в группе (3–6) */
const HEADCOUNT: Record<GroupCode, number> = { СР1: 6, СР2: 3, СР3: 4, СР5: 5, СР6: 4, СР9: 3 };

/** Оплаты по дням: сценарий каждой группы к 12.11 — взрослый, яйцо, малыш, скучает, болен (по кучкам), погиб и вылупился заново. */
const PAYMENTS: Record<GroupCode, Record<DateStr, number>> = {
  СР1: { '2026-11-02': 4, '2026-11-03': 6, '2026-11-05': 5, '2026-11-06': 7, '2026-11-09': 6, '2026-11-10': 5, '2026-11-11': 8, '2026-11-12': 4 },
  СР2: { '2026-11-03': 1, '2026-11-06': 2 },
  СР3: { '2026-11-02': 1, '2026-11-03': 1, '2026-11-05': 1, '2026-11-06': 1, '2026-11-09': 1, '2026-11-10': 1, '2026-11-11': 1, '2026-11-12': 1 },
  СР5: { '2026-11-02': 5, '2026-11-03': 6, '2026-11-05': 4, '2026-11-06': 5, '2026-11-09': 4, '2026-11-10': 3 },
  СР6: { '2026-11-02': 3, '2026-11-03': 3, '2026-11-05': 3, '2026-11-06': 3, '2026-11-09': 3, '2026-11-10': 3, '2026-11-11': 3, '2026-11-12': 3 },
  СР9: { '2026-11-02': 6 },
};

/** Группа, не выполняющая норму длинных (копит кучки). */
const MISSES_LONG: GroupCode = 'СР6';

/** Детерминированный набор для витрины и тестов: вымышленные сотрудники, воронка по нормам, оплаты по группам. */
export function buildDemo(asOf: DateStr): Demo {
  const cfg = defaultConfig;
  const staff: Employee[] = GROUPS.flatMap((group) =>
    Array.from({ length: HEADCOUNT[group] }, (_, i): Employee => ({
      id: `${group}-${i + 1}`,
      name: `Тест ${group}-${i + 1}`,
      shortName: `Тест ${LETTERS[i]}.`,
      group,
      hireDate: null,
      fireDate: null,
      baseLevel: 'experienced',
      hiddenFromRating: false,
      transfers: [],
    })),
  );
  const norm = cfg.norms.experienced;
  const funnel: FunnelDay[] = workingDaysBetween(cfg.startDate, asOf, cfg).flatMap((date) =>
    staff.map((e) => ({
      employeeId: e.id,
      date,
      quality: norm.quality,
      long: e.group === MISSES_LONG ? 0 : norm.long,
    })),
  );
  return { staff, absences: [], funnel, paymentsByGroup: PAYMENTS, cfg };
}

/** Факты одной группы для `simulate`: оплаты группы и оценка каждого рабочего дня до asOf. */
export function groupFacts(demo: Demo, group: GroupCode, asOf: DateStr): GroupFacts {
  const results = Object.fromEntries(
    workingDaysBetween(demo.cfg.startDate, asOf, demo.cfg).map((date) => [
      date,
      evaluateDay(group, date, demo.staff, demo.absences, demo.funnel, demo.cfg),
    ]),
  );
  return { group, paymentsByDay: demo.paymentsByGroup[group], results, overrides: [] };
}
