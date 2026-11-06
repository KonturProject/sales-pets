import { dayResults, type GroupLine } from '@/admin/results';
import { shortDate } from '@/admin/resultsText';
import type { Snapshot } from '@/data/api';
import { timelineOf } from '@/data/config';
import { buildFacts } from '@/data/facts';
import { addDays, isWorkingDay, nextWorkingDay, prevWorkingDay, workingDaysBetween } from '@/engine/calendar';
import { ruNum } from '@/engine/format';
import type { PetState } from '@/engine/pet';
import type { DateStr, GroupCode } from '@/engine/types';

/** Комната в событии «итоги дня»: плашка и состояния питомца до и после загрузки воронки. */
export interface RoomEvent { group: GroupCode; text: string; from: PetState; to: PetState }
/** `through` — `funnelThrough` снимка (его и запоминает ТВ), `days` — показанные рабочие дни, плашка — по последнему. */
export interface DayEventPlan { through: DateStr; days: DateStr[]; rooms: RoomEvent[] }

/**
 * Плашка комнаты: «СР3 · итоги 05.11: длинные 2 из 4 — кучка; качественные 7 из 6 — игрушка». Вердикт — `DayResult` дня,
 * а флаги `pile` / `pileRemoved` в `line.outcome` и `line.now` должны быть сужены до того, что случилось с питомцем
 * (так делает `dayEventPlan`): `pile` false при положенной кучке — «кучка (уже N)» с N = `now.piles`, «−1 кучка» — только
 * при `pileRemoved`. Без нормы длинных или качественных их части нет; дней больше одного — «· ещё N дн.».
 */
export function roomText(line: GroupLine, days: DateStr[]): string {
  const head = `${line.group} · итоги ${shortDate(days[days.length - 1])}`;
  const more = days.length > 1 ? ` · ещё ${days.length - 1} дн.` : '';
  const o = line.outcome;
  if (!o.evaluated) return head + more;
  const r = o.result;
  const parts: string[] = [];
  if (r.longRequired) {
    const verdict = r.longMet ? (o.pileRemoved ? 'аптечка, −1 кучка' : 'аптечка') : o.pile ? 'кучка' : `кучка (уже ${line.now.piles})`;
    parts.push(`длинные ${ruNum(r.factLong)} из ${ruNum(r.normLong)} — ${verdict}`);
  }
  if (r.normQuality > 0) parts.push(`качественные ${ruNum(r.factQuality)} из ${ruNum(r.normQuality)} — ${r.qualityMet ? 'игрушка' : 'без игрушки'}`);
  return (parts.length ? `${head}: ${parts.join('; ')}` : head) + more;
}

/**
 * Событие «итоги дня», если оно положено этому снимку, иначе null. Живое — `funnelThrough` стал позже, чем в `prev`
 * (`shown` не смотрим). При запуске (`prev` null) — сегодня следующий рабочий день после `funnelThrough` и его итоги ещё не
 * показаны (`shown`); «было» тогда — воронка по предыдущему рабочему дню. Дни — оценённые рабочие, награды за которые к
 * `asOf` уже пришли. Комнаты — живые, где по последнему дню положена кучка, аптечка или игрушка или где они изменились.
 */
export function dayEventPlan(prev: Snapshot | null, s: Snapshot, asOf: DateStr, shown: string | null): DayEventPlan | null {
  const through = s.funnelThrough;
  if (through === null) return null;
  const cfg = timelineOf(s).at(asOf);
  let wasThrough: DateStr | null;
  if (prev) {
    if (prev.funnelThrough !== null && prev.funnelThrough >= through) return null;
    wasThrough = prev.funnelThrough;
  } else {
    if (shown === through || nextWorkingDay(through, cfg) !== asOf) return null;
    const last = isWorkingDay(through, cfg) ? through : prevWorkingDay(through, cfg);
    if (last === null) return null;
    wasThrough = prevWorkingDay(last, cfg);
  }

  const landed = (d: DateStr) => {
    const next = nextWorkingDay(d, cfg);
    return next !== null && next <= asOf;
  };
  const days = workingDaysBetween(wasThrough === null ? cfg.startDate : addDays(wasThrough, 1), through, cfg).filter(landed);
  if (!days.length) return null;

  const was = buildFacts({ ...s, funnelThrough: wasThrough }, asOf).states;
  const now = buildFacts(s, asOf).states;
  const rooms: RoomEvent[] = [];
  for (const line of dayResults(s, days[days.length - 1])) {
    const from = was[line.group];
    const to = now[line.group];
    const o = line.outcome;
    const verdict = o.evaluated && (o.pile || o.medkit || o.toy);
    const changed = from.piles !== to.piles || from.medkits !== to.medkits || from.toys !== to.toys;
    if (!to.alive || !(verdict || changed)) continue;
    const happened: GroupLine = !o.evaluated ? line : {
      ...line, now: to, outcome: { ...o, pile: o.pile && to.piles > from.piles, pileRemoved: o.pileRemoved && to.piles < from.piles },
    };
    rooms.push({ group: line.group, text: roomText(happened, days), from, to });
  }
  return rooms.length ? { through, days, rooms } : null;
}

/**
 * План итогов дня по каждому снимку опроса: помнит прошлый снимок и запоминает новый раньше плана. Ошибка плана опрос
 * не роняет (иначе экран замер бы, а при запуске не появился бы вовсе): в консоль без данных, события нет.
 */
export function dayPlanner(): (s: Snapshot, asOf: DateStr, shown: string | null) => DayEventPlan | null {
  let prev: Snapshot | null = null;
  return (s, asOf, shown) => {
    const was = prev;
    prev = s;
    try {
      return dayEventPlan(was, s, asOf, shown);
    } catch (e) {
      console.error('Итоги дня не построены:', e instanceof Error ? e.message : e);
      return null;
    }
  };
}

/** Камера держит комнату события столько, но всё событие — не дольше `DAY_EVENT_MS`. */
const DAY_ROOM_MS = 7_000;
const DAY_EVENT_MS = 45_000;
/** Событие, прождавшее в режиме экономии дольше этого, снимается: числа в комнатах сразу текущие. */
const DAY_STALE_MS = 15 * 60_000;
/** Ящиков и облачков одного вида за комнату не больше: остальное — сразу конечными числами. */
const MAX_REPEAT = 2;

/** Время на комнату при `n` комнатах в очереди события. */
export function dayRoomMs(n: number): number {
  return Math.min(DAY_ROOM_MS, Math.floor(DAY_EVENT_MS / Math.max(1, n)));
}

/** Комната, поставленная в очередь в `at`, ждала в `idle` (с `idleSince`) дольше 15 мин. */
export function staleDay(at: number, idleSince: number, now: number): boolean {
  return now - Math.max(at, idleSince) > DAY_STALE_MS;
}

/** Анимация комнаты: `pile` — питомец тужится, потом новые кучки «пум»; `poof` — кучка исчезает облачком; ящики — в свой ящик. */
export type DayStep = 'pile' | 'poof' | 'medkit' | 'toy';

/**
 * Анимации по разнице «было → стало» в порядке плашки: длинные (кучка; или аптечка, потом убранные кучки), потом игрушки.
 * Одна потуга на все новые кучки; ящиков и облачков каждого вида не больше двух. Убыль запасов (потрачены) не анимируется.
 */
export function daySteps(from: PetState, to: PetState): DayStep[] {
  const times = (step: DayStep, n: number) => Array<DayStep>(Math.max(0, Math.min(MAX_REPEAT, n))).fill(step);
  return [
    ...(to.piles > from.piles ? ['pile' as const] : []),
    ...times('medkit', to.medkits - from.medkits),
    ...times('poof', from.piles - to.piles),
    ...times('toy', to.toys - from.toys),
  ];
}

/**
 * Вторая загрузка во время события: её комнаты — в конец очереди. Группа, которая ещё ждёт очереди, заменяется новой
 * записью в конце, но «было» остаётся прежним — его и показывает комната. Показываемой сейчас группы в очереди нет:
 * её новая запись просто встаёт в конец.
 */
export function enqueueDay<T extends RoomEvent>(queue: readonly T[], rooms: readonly T[]): T[] {
  const out = [...queue];
  for (const r of rooms) {
    const k = out.findIndex((q) => q.group === r.group);
    const from = k < 0 ? r.from : out.splice(k, 1)[0]!.from;
    out.push({ ...r, from });
  }
  return out;
}
