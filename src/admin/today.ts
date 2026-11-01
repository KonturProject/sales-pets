import { serverToday, type Snapshot } from '@/data/api';
import { configOf } from '@/data/config';
import { prevWorkingDay } from '@/engine/calendar';
import type { DateStr } from '@/engine/types';
import { GROUPS } from '@/engine/types';
import { dayLine } from '@/game/tv/metrics';

const short = (d: DateStr) => `${d.slice(8)}.${d.slice(5, 7)}`;

export interface TodayTask {
  done: boolean;
  text: string;
}

/**
 * Что сделать сегодня, по снимку: штат, новички без даты приёма, воронка и оплаты из файлов за последний рабочий день
 * игры до сегодняшнего (в первый день файлов за «вчера» ещё не ждём).
 */
export function todayTasks(s: Snapshot): TodayTask[] {
  const today = serverToday(s);
  const active = s.staff.filter((e) => !e.fireDate || today < e.fireDate);
  if (!active.length) return [{ done: false, text: 'Штата нет: Импорт → воронка, из неё добавятся сотрудники' }];
  const tasks: TodayTask[] = [{ done: true, text: `Штат: ${active.length}` }];
  const undated = active.filter((e) => e.baseLevel !== 'experienced' && !e.hireDate).length;
  if (undated) tasks.push({ done: false, text: `Новички без даты приёма: ${undated} — без даты уровень не сменится сам до конца игры (Сотрудники)` });
  const due = prevWorkingDay(today, configOf(s.config));
  if (due === null) return tasks;
  tasks.push(s.funnelThrough && s.funnelThrough >= due
    ? { done: true, text: `Воронка по ${short(s.funnelThrough)}` }
    : { done: false, text: `Загрузите воронку за ${short(due)} (Импорт)` });
  tasks.push(s.paymentsImportedThrough && s.paymentsImportedThrough >= due
    ? { done: true, text: `Оплаты из файла по ${short(s.paymentsImportedThrough)}` }
    : { done: false, text: `Загрузите оплаты за ${short(due)} (Импорт)` });
  return tasks;
}

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
