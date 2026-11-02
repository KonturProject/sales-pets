import type { SnapshotConfig } from '@/data/api';
import type { Config } from '@/engine/config';
import type { Level } from '@/engine/types';
import { ruDate } from './dom';

export interface ConfigForm {
  maxPiles: string;
  boredomBelow: string;
  sickDaysNoPay: string;
  sickPilesAbove: string;
  deathDaysNoPay: string;
  norms: Record<Level, { quality: string; long: string; payments: string }>;
  stageThresholds: string[];
}

export const LEVELS: readonly Level[] = ['experienced', 'rookie1', 'rookie2'];
export const LEVEL_TITLE: Record<Level, string> = { experienced: 'Опытный', rookie1: 'Новичок 1', rookie2: 'Новичок 2' };
export const NORM_FIELD_TITLE = { quality: 'качественные', long: 'длинные', payments: 'оплат в день' } as const;
export const NORM_FIELDS = ['quality', 'long', 'payments'] as const;

/** Норма оплат в форме — с запятой, как пишут по-русски. */
export const ruNumber = (n: number): string => String(n).replace('.', ',');

export const SCALARS = {
  maxPiles: 'Кучек (максимум)',
  boredomBelow: 'Скука: оплат за вчера меньше',
  sickDaysNoPay: 'Болезнь: дней без оплат',
  sickPilesAbove: 'Болезнь: кучек больше',
  deathDaysNoPay: 'Смерть: дней без оплат',
} as const;
export type Scalar = keyof typeof SCALARS;
export const SCALAR_KEYS = Object.keys(SCALARS) as Scalar[];

export function configFormOf(current: Config): ConfigForm {
  const norms = Object.fromEntries(LEVELS.map((l) => [
    l,
    { quality: String(current.norms[l].quality), long: String(current.norms[l].long), payments: ruNumber(current.norms[l].payments) },
  ])) as ConfigForm['norms'];
  return {
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
/** Не больше двух знаков после запятой или точки: так же проверяет сервер. */
const hundredths = (text: string): number | null => (/^\d+([.,]\d{1,2})?$/.test(text.trim()) ? Number(text.trim().replace(',', '.')) : null);

/**
 * Что отправить в `setConfig`: только изменённое. Что это число нужного вида, проверяется здесь, а диапазоны —
 * на сервере (его сообщение админ увидит как есть); порядок порогов стадий проверяется здесь, он нужен для всех четырёх.
 */
export function configPatch(form: ConfigForm, current: Config, from?: string): SnapshotConfig | { error: string } {
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
    const pays = hundredths(form.norms[level].payments);
    if (pays === null) return { error: `${LEVEL_TITLE[level]}, ${NORM_FIELD_TITLE.payments}: число, например 0,4 (не больше двух знаков после запятой)` };
    if (pays !== current.norms[level].payments) norms[level] = { ...norms[level], payments: pays };
  }
  if (Object.keys(norms).length) out.norms = norms;

  const thresholds: number[] = [];
  for (const [i, text] of form.stageThresholds.entries()) {
    const n = whole(text);
    // поля подписаны «Стадия 2, %» … «Стадия 5, %»: ошибка называет поле так же
    if (n === null) return { error: `Стадия ${i + 2}, %: введите целое число` };
    if (i > 0 && n <= thresholds[i - 1]!) return { error: `Стадия ${i + 2}: процент должен быть больше, чем у стадии ${i + 1}` };
    thresholds.push(n);
  }
  if (thresholds.some((n, i) => n !== current.stageThresholds[i])) {
    if (from !== undefined) return { error: 'Пороги стадий меняются только на всю игру: очистите дату' };
    out.stageThresholds = thresholds;
  }

  return Object.keys(out).length ? out : { error: 'Ничего не изменено' };
}
