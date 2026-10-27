import type { SnapshotConfig } from '@/data/api';
import type { Config } from '@/engine/config';
import type { Level } from '@/engine/types';
import { ruDate } from './dom';

/** Настройки игры вместе с дневной нормой оплат: в `Config` её нет, она живёт в снимке отдельно. */
export type ConfigCurrent = Config & { dailyNorm: number };

export interface ConfigForm {
  dailyNorm: string;
  maxPiles: string;
  boredomBelow: string;
  sickDaysNoPay: string;
  sickPilesAbove: string;
  deathDaysNoPay: string;
  norms: Record<Level, { quality: string; long: string }>;
  stageThresholds: string[];
}

export const LEVELS: readonly Level[] = ['experienced', 'rookie1', 'rookie2'];
export const LEVEL_TITLE: Record<Level, string> = { experienced: 'Опытный', rookie1: 'Новичок 1', rookie2: 'Новичок 2' };
export const NORM_FIELD_TITLE = { quality: 'качественные', long: 'длинные' } as const;

export const SCALARS = {
  dailyNorm: 'Дневная норма оплат',
  maxPiles: 'Кучек (максимум)',
  boredomBelow: 'Скука: оплат за вчера меньше',
  sickDaysNoPay: 'Болезнь: дней без оплат',
  sickPilesAbove: 'Болезнь: кучек больше',
  deathDaysNoPay: 'Смерть: дней без оплат',
} as const;
export type Scalar = keyof typeof SCALARS;
export const SCALAR_KEYS = Object.keys(SCALARS) as Scalar[];

export function configFormOf(current: ConfigCurrent): ConfigForm {
  const norms = Object.fromEntries(LEVELS.map((l) => [
    l,
    { quality: String(current.norms[l].quality), long: String(current.norms[l].long) },
  ])) as ConfigForm['norms'];
  return {
    dailyNorm: String(current.dailyNorm),
    maxPiles: String(current.maxPiles),
    boredomBelow: String(current.boredomBelow),
    sickDaysNoPay: String(current.sickDaysNoPay),
    sickPilesAbove: String(current.sickPilesAbove),
    deathDaysNoPay: String(current.deathDaysNoPay),
    norms,
    stageThresholds: current.stageThresholds.map(String),
  };
}

const whole = (text: string): number | null => (/^-?\d+$/.test(text.trim()) ? Number(text.trim()) : null);

/**
 * Что отправить в `setConfig`: только изменённое. Что это целое число, проверяется здесь, а диапазоны —
 * на сервере (его сообщение админ увидит как есть); порядок порогов стадий проверяется здесь, он нужен для всех 15.
 */
export function configPatch(form: ConfigForm, current: ConfigCurrent, from?: string): SnapshotConfig | { error: string } {
  if (from !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from < current.startDate || from > current.endDate)) {
    return { error: `Дата правки: выберите день игры, с ${ruDate(current.startDate)} по ${ruDate(current.endDate)}` };
  }
  const out: SnapshotConfig = {};

  for (const key of SCALAR_KEYS) {
    const n = whole(form[key]);
    if (n === null) return { error: `${SCALARS[key]}: введите целое число` };
    if (n !== current[key]) out[key] = n;
  }

  const norms: NonNullable<SnapshotConfig['norms']> = {};
  for (const level of LEVELS) {
    for (const field of ['quality', 'long'] as const) {
      const n = whole(form.norms[level][field]);
      if (n === null) return { error: `${LEVEL_TITLE[level]}, ${NORM_FIELD_TITLE[field]}: введите целое число` };
      if (n !== current.norms[level][field]) norms[level] = { ...norms[level], [field]: n };
    }
  }
  if (Object.keys(norms).length) out.norms = norms;

  const thresholds: number[] = [];
  for (const [i, text] of form.stageThresholds.entries()) {
    const n = whole(text);
    if (n === null) return { error: `Порог ${i + 1}: введите целое число` };
    if (i > 0 && n <= thresholds[i - 1]!) return { error: `Порог ${i + 1} должен быть больше порога ${i}` };
    thresholds.push(n);
  }
  if (thresholds.some((n, i) => n !== current.stageThresholds[i])) {
    if (from !== undefined) return { error: 'Пороги стадий меняются только на всю игру: очистите дату' };
    out.stageThresholds = thresholds;
  }

  return Object.keys(out).length ? out : { error: 'Ничего не изменено' };
}
