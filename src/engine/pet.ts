import { prevWorkingDay, workingDaysBetween } from './calendar';
import type { Config } from './config';
import type { DayResult } from './evaluate';
import type { DateStr, GroupCode } from './types';

export interface Override {
  date: DateStr;
  /** piles/medkits/toys: прибавить delta (может быть < 0); useMedkit/useToy: потратить один предмет */
  kind: 'piles' | 'medkits' | 'toys' | 'useMedkit' | 'useToy';
  delta: number;
}

export interface GroupFacts {
  group: GroupCode;
  /** оплаты группы по дням (на выходные — тоже, засчитываются со следующего рабочего дня) */
  paymentsByDay: Record<DateStr, number>;
  /** оценка выполнения норм по дням */
  results: Record<DateStr, DayResult>;
  overrides: Override[];
  /** дневная норма оплат группы (среднее прошлого месяца) — только для сытости */
  dailyNorm?: number;
}

export type Phase = 'egg0' | 'egg1' | 'egg2' | 'pet';
export type Mood = 'ok' | 'bored' | 'sad' | 'sick' | 'dead';

export interface PetState {
  alive: boolean;
  generation: number;
  totalPayments: number;
  phase: Phase;
  /** 0..15 после вылупления */
  stage: number;
  medkits: number;
  toys: number;
  piles: number;
  mood: Mood;
  /** 0..1: оплаты сегодня к дневной норме */
  satiety: number;
}

const HATCH_AT = 5;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function phaseOf(total: number): Phase {
  if (total >= HATCH_AT) return 'pet';
  if (total >= 3) return 'egg2';
  if (total >= 1) return 'egg1';
  return 'egg0';
}

/**
 * Состояние питомца на дату asOf — чистая функция фактов (идемпотентна).
 * Идёт по рабочим дням: в начале дня применяются награды за предыдущий рабочий день,
 * затем оплаты и ручные правки дня. Данные на выходные относятся к следующему рабочему дню;
 * то, что пришло после последнего рабочего дня до asOf, добавляется в конце.
 * `cfgOn` отдаёт настройки на дату: награды, пределы кучек и порог смерти берутся по дню события;
 * пороги стадий, болезнь, скука и сытость на asOf — из `cfg` (настройки на asOf).
 */
export function simulate(facts: GroupFacts, asOf: DateStr, cfg: Config, cfgOn: (d: DateStr) => Config = () => cfg): PetState {
  const days = workingDaysBetween(cfg.startDate, asOf, cfg);
  const dayIndex = (date: DateStr): number => days.findIndex((d) => d >= date); // -1: «хвост» после последнего рабочего дня

  const payments = new Map<number, number>(); // индекс дня (или days.length для хвоста) → оплаты
  let tailKey = days.length;
  for (const [date, n] of Object.entries(facts.paymentsByDay)) {
    if (date > asOf || date < cfg.startDate) continue;
    const i = dayIndex(date);
    const k = i === -1 ? tailKey : i;
    payments.set(k, (payments.get(k) ?? 0) + n);
  }
  const ovByDay = new Map<number, Override[]>();
  facts.overrides.forEach((o) => {
    if (o.date > asOf) return;
    const i = o.date < cfg.startDate ? 0 : dayIndex(o.date);
    const k = i === -1 ? tailKey : Math.max(i, 0);
    ovByDay.set(k, [...(ovByDay.get(k) ?? []), o]);
  });

  let generation = 0, total = 0, piles = 0, medkits = 0, toys = 0;
  let deathStreak = 0, sickStreak = 0;
  let alive = true;
  /** смерть обнаружена в конце вчерашнего дня: сегодня питомец ещё «мёртв», яйцо — со следующего рабочего дня */
  let deadPending = false;
  let toyToday = false;

  /** Новое яйцо после смерти: история поколений сохраняется, счёт и болезни обнуляются. */
  const revive = () => {
    alive = true; deadPending = false;
    generation++; total = 0; piles = 0; deathStreak = 0; sickStreak = 0;
  };

  const applyOverrides = (list: Override[] | undefined, c: Config) => {
    for (const o of list ?? []) {
      if (o.kind === 'piles') piles = clamp(piles + o.delta, 0, c.maxPiles);
      else if (o.kind === 'medkits') medkits = Math.max(0, medkits + o.delta);
      else if (o.kind === 'toys') toys = Math.max(0, toys + o.delta);
      else if (o.kind === 'useMedkit' && alive && medkits > 0) {
        medkits--;
        sickStreak = 0;
        piles = Math.min(piles, c.sickPilesAbove);
      } else if (o.kind === 'useToy' && alive && toys > 0) {
        toys--;
        toyToday = true;
      }
    }
  };

  days.forEach((d, i) => {
    const current = i === days.length - 1 && d === asOf;
    const c = cfgOn(d);
    toyToday = false;
    if (!alive) {
      // в день надгробия первая же оплата сразу даёт новое яйцо; иначе яйцо — со следующего рабочего дня
      if (deadPending && (payments.get(i) ?? 0) === 0) { deadPending = false; total = 0; }
      else revive();
    }
    piles = Math.min(piles, c.maxPiles); // предел мог снизиться с этого дня: кучки срезаются, задним числом не пересчитываются
    const prev = prevWorkingDay(d, cfg);
    const r = prev ? facts.results[prev] : undefined;
    if (r) {
      if (r.longRequired) {
        if (r.longMet) { medkits++; piles = Math.max(0, piles - 1); }
        else piles = Math.min(c.maxPiles, piles + 1);
      }
      if (r.qualityMet) toys++;
    }
    const p = payments.get(i) ?? 0;
    total += p;
    applyOverrides(ovByDay.get(i), c);

    if (current) {
      if (p > 0) { deathStreak = 0; sickStreak = 0; }
    } else if (p > 0) {
      deathStreak = 0; sickStreak = 0;
    } else {
      deathStreak++; sickStreak++;
      if (alive && total >= HATCH_AT && deathStreak >= c.deathDaysNoPay) { alive = false; deadPending = true; }
    }
  });

  // оплаты и правки после последнего рабочего дня (выходные до asOf)
  const lastDay = days[days.length - 1];
  const tailPayments = payments.get(tailKey) ?? 0;
  if (lastDay !== undefined && lastDay !== asOf) {
    toyToday = false;
    if (tailPayments > 0) {
      if (!alive) revive();
      deathStreak = 0; sickStreak = 0;
    }
    total += tailPayments;
    piles = Math.min(piles, cfg.maxPiles);
    applyOverrides(ovByDay.get(tailKey), cfg);
  } else if (lastDay === undefined) {
    total += tailPayments;
  }

  // оплаты «сегодня» и «вчера» для скуки и сытости
  const todayP = lastDay === asOf ? payments.get(days.length - 1) ?? 0 : tailPayments;
  let lastCompleted: number | null = null;
  if (lastDay === asOf) { if (days.length > 1) lastCompleted = payments.get(days.length - 2) ?? 0; }
  else if (lastDay !== undefined) lastCompleted = payments.get(days.length - 1) ?? 0;

  const phase = phaseOf(total);
  const stage = phase === 'pet' ? cfg.stageThresholds.filter((t) => t <= total).length : 0;

  let mood: Mood = 'ok';
  if (!alive) mood = 'dead';
  else if (phase === 'pet') {
    const sick = sickStreak >= cfg.sickDaysNoPay || piles > cfg.sickPilesAbove;
    const bored = lastCompleted !== null && lastCompleted < cfg.boredomBelow && todayP < cfg.boredomBelow;
    if (sick) mood = 'sick';
    else if (!toyToday && piles >= 1) mood = 'sad';
    else if (!toyToday && bored) mood = 'bored';
  }

  const norm = Math.max(1, facts.dailyNorm ?? 1);
  return {
    alive, generation, totalPayments: total, phase, stage, medkits, toys, piles, mood,
    satiety: Math.min(1, todayP / norm),
  };
}

