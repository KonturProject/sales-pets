import { workingDaysBetween } from './calendar';
import type { Config } from './config';
import { groupOn, isPresent, levelOn, type Absence, type Employee } from './staff';
import type { DateStr, GroupCode } from './types';

/** Показатели воронки сотрудника за день: качественные счета и разговоры от 20 минут. */
export interface FunnelDay {
  employeeId: string;
  date: DateStr;
  quality: number;
  long: number;
}

export interface DayResult {
  group: GroupCode;
  date: DateStr;
  normQuality: number;
  normLong: number;
  factQuality: number;
  factLong: number;
  /** норма длинных задана (>0): иначе кучка не начисляется и аптечка не выдаётся */
  longRequired: boolean;
  longMet: boolean;
  qualityMet: boolean;
}

export function evaluateDay(
  group: GroupCode, date: DateStr, staff: Employee[], absences: Absence[], funnel: FunnelDay[], cfg: Config,
): DayResult {
  const present = staff.filter((e) => groupOn(e, date) === group && isPresent(e, date, absences));
  // нормы дробные (до 0,01): копим в целых сотых, чтобы 0,1 + 0,2 не давали ошибок округления
  let qualityCents = 0, longCents = 0, factQuality = 0, factLong = 0;
  for (const e of present) {
    const n = cfg.norms[levelOn(e, date)];
    qualityCents += Math.round(n.quality * 100);
    longCents += Math.round(n.long * 100);
    for (const row of funnel) {
      if (row.employeeId === e.id && row.date === date) { factQuality += row.quality; factLong += row.long; }
    }
  }
  return {
    group, date, normQuality: qualityCents / 100, normLong: longCents / 100, factQuality, factLong,
    longRequired: longCents > 0,
    longMet: longCents > 0 && factLong * 100 >= longCents,
    qualityMet: qualityCents > 0 && factQuality * 100 >= qualityCents,
  };
}

/** План оплат группы на день в сотых оплаты: сумма личных норм «оплат в день» присутствующих сотрудников по уровню. */
export function paymentPlanCents(group: GroupCode, date: DateStr, staff: Employee[], absences: Absence[], cfg: Config): number {
  let cents = 0;
  for (const e of staff) {
    if (groupOn(e, date) === group && isPresent(e, date, absences)) cents += Math.round(cfg.norms[levelOn(e, date)].payments * 100);
  }
  return cents;
}

export interface GroupPlan {
  /** план оплат группы на все рабочие дни игры, в сотых */
  gameCents: number;
  /** план на день asOf, в сотых: от него сытость */
  dayCents: number;
}

/** План оплат группы: на игру (по нормам каждого дня, `cfgOn`) и на день asOf. Нужен стадиям роста и сытости. */
export function groupPlan(
  group: GroupCode, asOf: DateStr, staff: Employee[], absences: Absence[], cfgOn: (d: DateStr) => Config, cfg: Config,
): GroupPlan {
  let gameCents = 0;
  for (const d of workingDaysBetween(cfg.startDate, cfg.endDate, cfg)) gameCents += paymentPlanCents(group, d, staff, absences, cfgOn(d));
  return { gameCents, dayCents: paymentPlanCents(group, asOf, staff, absences, cfgOn(asOf)) };
}
