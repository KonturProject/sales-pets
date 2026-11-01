import { serverToday, type Snapshot } from '@/data/api';
import { configOf } from '@/data/config';
import type { DateStr } from '@/engine/types';
import { GROUPS } from '@/engine/types';
import { dayLine } from '@/game/tv/metrics';

const short = (d: DateStr) => `${d.slice(8)}.${d.slice(5, 7)}`;

/** Блок «Сегодня» над вкладками: день игры, что загружено из файлов и сколько групп внесли предварительные числа. */
export function todayLine(s: Snapshot): string {
  const today = serverToday(s);
  const entered = new Set(s.provisional.filter((p) => p.date === today).map((p) => p.group)).size;
  return [
    `Сегодня ${short(today)}`,
    dayLine(today, configOf(s.config)),
    s.funnelThrough ? `воронка по ${short(s.funnelThrough)}` : 'воронки ещё нет',
    s.paymentsImportedThrough ? `оплаты из файла по ${short(s.paymentsImportedThrough)}` : 'оплат из файла ещё нет',
    `предварительные сегодня: ${entered} из ${GROUPS.length} групп`,
  ].join(' · ');
}
