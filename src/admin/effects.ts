import { serverToday, type Snapshot } from '@/data/api';
import { timelineOf } from '@/data/config';
import { workingDaysBetween } from '@/engine/calendar';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import { petChanges, type GroupChange } from './configPreview';
import { correctionViews, dayResults, type CorrectionView, type Outcome } from './results';
import { outcomeLines, shortDate } from './resultsText';

/** Что изменится при переходе от снимка `before` к `after`: итоги прошлых дней, питомцы сегодня, устаревшие правки. */
export interface Effects {
  /** оценённые дни, у которых изменился итог группы; `before` и `after` — только изменившиеся части итога */
  days: { group: GroupCode; date: DateStr; before: string; after: string }[];
  /** питомцы на сегодня (по серверу), у которых что-то изменилось */
  now: GroupChange[];
  /** правки, у которых значение «из файла» после перехода не то, что админ видел (`base`) */
  stale: CorrectionView[];
}

/** Итог дня двумя частями, как «Итог дня» в таблице: длинные (кучка, аптечка) и качественные (игрушка). */
function partsOf(o: Outcome): { long: string; quality: string } | null {
  if (!o.evaluated) return null;
  const r = o.result;
  return {
    long: !r.longRequired ? 'длинные: нормы нет' : r.longMet ? 'аптечка' : '+1 кучка',
    quality: r.qualityMet ? 'игрушка' : 'нет игрушки',
  };
}

/** До/после одного итога дня: у оценённого дня — только изменившиеся части; день, переставший оцениваться, — целиком. */
function describeDay(before: Outcome, after: Outcome): { before: string; after: string } | null {
  const was = partsOf(before);
  const now = partsOf(after);
  if (!was || !now) {
    if (!was && !now) return null;
    const text = (o: Outcome) => (o.evaluated ? partsOf(o)!.long + ', ' + partsOf(o)!.quality : outcomeLines(o)[0]);
    return { before: text(before), after: text(after) };
  }
  const changed = (['long', 'quality'] as const).filter((k) => was[k] !== now[k]);
  if (!changed.length) return null;
  return { before: changed.map((k) => was[k]).join(', '), after: changed.map((k) => now[k]).join(', ') };
}

/** «СР1 03.11: +1 кучка → аптечка». */
export const dayChangeText = (d: Effects['days'][number]): string => `${d.group} ${shortDate(d.date)}: ${d.before} → ${d.after}`;

/**
 * Изменения оценок уже оценённых дней (рабочие дни по `funnelThrough` до перехода; день, который оценивается впервые,
 * не «переписан»), питомцев на сегодня и устаревшие правки после перехода. Снимки не меняются.
 */
export function effectsOf(before: Snapshot, after: Snapshot): Effects {
  const asOf = serverToday(before);
  const through = before.funnelThrough;
  const cfg = timelineOf(before).at(asOf);
  const evaluated = through === null ? [] : workingDaysBetween(cfg.startDate, through < asOf ? through : asOf, cfg);

  const days: Effects['days'] = [];
  for (const date of evaluated) {
    const was = dayResults(before, date);
    const now = dayResults(after, date);
    for (const group of GROUPS) {
      const line = was.find((l) => l.group === group)!;
      const next = now.find((l) => l.group === group)!;
      if (line.employees.length === 0 && next.employees.length === 0) continue; // в группе в этот день никого ни до, ни после: итога дня нет
      const change = describeDay(line.outcome, next.outcome);
      if (change) days.push({ group, date, ...change });
    }
  }
  return { days, now: petChanges(before, after, asOf), stale: correctionViews(after).filter((v) => v.stale) };
}
