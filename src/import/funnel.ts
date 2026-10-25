import { parseDate } from '@/engine/calendar';
import { normalizeName } from '@/engine/staff';
import type { DateStr, GroupCode } from '@/engine/types';
import { excelDate, groupOf, readGrid, text } from './xlsx';

export interface FunnelEmployee {
  name: string;
  group: GroupCode;
}

/** Показатели сотрудника за день; нули тоже строки (ноль и «ещё не заполнено» различает дата `through`, а не файл). */
export interface FunnelRow {
  name: string;
  date: DateStr;
  quality: number;
  long: number;
}

export interface ParsedFunnel {
  /** порядок как в файле */
  employees: FunnelEmployee[];
  rows: FunnelRow[];
  /** границы дат в колонках метрик (в том числе ещё пустых) */
  firstDate: DateStr | null;
  lastDate: DateStr | null;
}

/**
 * Разметка файла «АП_НП_СР_Воронка_Дни…», лист «ВОРОНКА Первичная кампания» (подтверждена на образце за октябрь 2026):
 * - строка заголовков содержит подписи метрик и подписи колонок-флагов «группа» и «сотр»; строка под ней — даты;
 * - строка группы: флаг «группа» = 1, подпись с кодом СР<N>; строка сотрудника: флаг «сотр» = 1, подпись — ФИО,
 *   сотрудник принадлежит последней встреченной группе; остальные строки (итоги) игнорируются;
 * - блок метрики идёт от своей подписи до следующей непустой подписи в строке заголовков; в блоке по колонке на
 *   будний день и по колонке недельного итога (заголовок «2026.43») — итоги датой не считаются.
 */
const LABELS = { long: 'Разговоры от 20 минут, шт.', quality: 'Качественные счета, шт.' } as const;
const FLAGS = { group: 'группа', employee: 'сотр' } as const;
const SHEET_PATTERN = /первичн/i;
const NO_DATE: DateStr = '';

const key = (v: unknown) => normalizeName(text(v));
const isFlag = (v: unknown) => v === 1 || text(v) === '1';
const countOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Дата заголовка: серийное число Excel в правдоподобном окне, `yyyy-MM-dd` или `dd.MM.yyyy`; иначе колонка не день. */
function dateOf(v: unknown): DateStr | null {
  const serial = excelDate(v);
  if (serial !== null) return serial;
  if (typeof v !== 'string') return null;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v.trim());
  const d = parseDate(ru ? `${ru[3]}-${ru[2]}-${ru[1]}` : v.trim(), NO_DATE);
  return d === NO_DATE ? null : d;
}

/** Колонки-дни блока метрики: дата → индекс колонки. */
function blockColumns(header: unknown[], dates: unknown[], start: number): Map<DateStr, number> {
  let end = start + 1;
  while (end < header.length && key(header[end]) === '') end++;
  const cols = new Map<DateStr, number>();
  for (let c = start; c < end; c++) {
    const d = dateOf(dates[c]);
    if (d !== null && !cols.has(d)) cols.set(d, c);
  }
  return cols;
}

export function parseFunnelGrid(grid: unknown[][]): ParsedFunnel {
  const headerRow = grid.findIndex((r) => r.some((c) => key(c) === key(LABELS.long)));
  if (headerRow < 0) throw new Error(`Не найдена подпись «${LABELS.long}»`);
  const header = grid[headerRow]!;
  const column = (label: string, what: 'подпись' | 'колонка'): number => {
    const c = header.findIndex((v) => key(v) === key(label));
    if (c < 0) throw new Error(`Не найдена ${what} «${label}»`);
    return c;
  };
  const longStart = column(LABELS.long, 'подпись');
  const qualityStart = column(LABELS.quality, 'подпись');
  const groupFlag = column(FLAGS.group, 'колонка');
  const employeeFlag = column(FLAGS.employee, 'колонка');

  const dateRow = grid[headerRow + 1] ?? [];
  const longCols = blockColumns(header, dateRow, longStart);
  const qualityCols = blockColumns(header, dateRow, qualityStart);
  const dates = [...new Set([...longCols.keys(), ...qualityCols.keys()])].sort();

  const labelFrom = Math.max(groupFlag, employeeFlag) + 1;
  const labelTo = Math.min(longStart, qualityStart);
  const labelOf = (r: unknown[]): string =>
    r.slice(labelFrom, labelTo).map((v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')).find((s) => s !== '') ?? '';

  const employees: FunnelEmployee[] = [];
  const rows: FunnelRow[] = [];
  let group: GroupCode | null = null;
  for (const r of grid.slice(headerRow + 2)) {
    if (isFlag(r[groupFlag])) {
      group = groupOf(labelOf(r));
    } else if (isFlag(r[employeeFlag])) {
      const name = labelOf(r);
      if (group === null || name === '') continue;
      employees.push({ name, group });
      for (const date of dates) {
        rows.push({ name, date, quality: countOf(r[qualityCols.get(date) ?? -1]), long: countOf(r[longCols.get(date) ?? -1]) });
      }
    }
  }
  return { employees, rows, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null };
}

export function parseFunnelXlsx(buf: ArrayBuffer): ParsedFunnel {
  return parseFunnelGrid(readGrid(buf, (name) => SHEET_PATTERN.test(name)));
}
