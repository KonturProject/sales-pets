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
  let normQuality = 0, normLong = 0, factQuality = 0, factLong = 0;
  for (const e of present) {
    const n = cfg.norms[levelOn(e, date)];
    normQuality += n.quality;
    normLong += n.long;
    for (const row of funnel) {
      if (row.employeeId === e.id && row.date === date) { factQuality += row.quality; factLong += row.long; }
    }
  }
  return {
    group, date, normQuality, normLong, factQuality, factLong,
    longRequired: normLong > 0,
    longMet: normLong > 0 && factLong >= normLong,
    qualityMet: normQuality > 0 && factQuality >= normQuality,
  };
}
