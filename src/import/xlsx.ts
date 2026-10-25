import * as XLSX from 'xlsx';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';

/** Ячейка как обрезанная строка; пусто и null — пустая строка. */
export const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** Код группы из названия вида «АП_НП_СР_Москва_СР5_ГБ_УД»; вне шести групп — null. */
export function groupOf(v: unknown): GroupCode | null {
  const code = /СР\d+/.exec(text(v))?.[0];
  return GROUPS.find((g) => g === code) ?? null;
}

/** Правдоподобное окно серийных дат Excel (2009–2064): отсекает заголовки недель вида 2026.43 и мусор. */
const MIN_SERIAL = 40000;
const MAX_SERIAL = 60000;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** Серийная дата Excel → `yyyy-MM-dd` (время суток отбрасывается); не число или вне окна → null. */
export function excelDate(v: unknown): DateStr | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < MIN_SERIAL || v >= MAX_SERIAL) return null;
  return new Date(EXCEL_EPOCH_MS + Math.floor(v) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Первый лист (или первый, подходящий под `pick`) как таблица значений. Числа остаются числами (даты — серийными),
 * пустые ячейки — пустой строкой; индексы строк и колонок считаются от A1, а не от начала данных.
 * Распаковывается только выбранный лист.
 */
export function readGrid(buf: ArrayBuffer, pick?: (sheetName: string) => boolean): unknown[][] {
  const names = XLSX.read(buf, { type: 'array', bookSheets: true }).SheetNames;
  const name = pick ? names.find((n) => pick(n)) : names[0];
  if (name === undefined) throw new Error('Не найден нужный лист в файле');
  const ws = XLSX.read(buf, { type: 'array', sheets: name }).Sheets[name];
  if (!ws?.['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  range.s = { r: 0, c: 0 };
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range, defval: '', blankrows: true, raw: true });
}
