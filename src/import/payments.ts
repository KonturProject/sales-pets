import { uniqueInvoices } from '@/engine/ranking';
import { normalizeName } from '@/engine/staff';
import type { DateStr, GroupCode } from '@/engine/types';
import { excelDate, groupOf, readGrid, text } from './xlsx';

/** Оплата из выгрузки «Детальные данные по оплаченным счетам»; сумма после фильтра никому не нужна и не хранится. */
export interface ImportedPayment {
  date: DateStr;
  group: GroupCode;
  author: string;
  invoice: string;
}

export interface SkippedRow {
  /** номер строки в Excel, с единицы */
  row: number;
  reason: 'duplicate' | 'cheap' | 'unknownGroup' | 'noInvoice' | 'badDate';
}

/** Счета дешевле этой суммы (например, «Академия») оплатой не считаются. */
const MIN_AMOUNT = 100;

const COLUMNS = {
  invoice: '№ счета',
  date: 'Дата оплаты',
  group: 'Группа',
  author: 'Автор',
  amount: 'Сумма',
} as const;

function amountOf(v: unknown): number {
  return typeof v === 'number' ? v : Number(text(v).replace(/\s/g, '').replace(',', '.'));
}

/** Колонки находятся по тексту заголовка, строка заголовка — первая с «№ счета»; без неё файл не наш. */
function locateColumns(grid: unknown[][]): { header: number; col: Record<keyof typeof COLUMNS, number> } {
  const key = (v: unknown) => normalizeName(text(v));
  const header = grid.findIndex((r) => r.some((c) => key(c) === key(COLUMNS.invoice)));
  if (header < 0) throw new Error(`Не найдена колонка «${COLUMNS.invoice}»`);
  const col = {} as Record<keyof typeof COLUMNS, number>;
  for (const name of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) {
    col[name] = grid[header]!.findIndex((c) => key(c) === key(COLUMNS[name]));
    if (col[name] < 0) throw new Error(`Не найдена колонка «${COLUMNS[name]}»`);
  }
  return { header, col };
}

/**
 * Разбор выгрузки оплат. Оплата = уникальный «№ счета»; строки дешевле 100 ₽, вне шести групп, без номера
 * счёта (итоговая строка) или с непонятной датой отбрасываются и перечисляются в `skipped`. При повторе счёта
 * остаётся строка с самой ранней датой, при равной — с меньшим нормализованным ФИО, поэтому порядок строк
 * в файле не влияет на результат.
 */
export function parsePaymentsGrid(grid: unknown[][]): { rows: ImportedPayment[]; skipped: SkippedRow[] } {
  if (grid.every((r) => r.every((c) => text(c) === ''))) return { rows: [], skipped: [] };
  const { header, col } = locateColumns(grid);
  const skipped: SkippedRow[] = [];
  const kept: (ImportedPayment & { row: number })[] = [];
  for (let i = header + 1; i < grid.length; i++) {
    const r = grid[i]!;
    if (r.every((c) => text(c) === '')) continue;
    const row = i + 1;
    const invoice = text(r[col.invoice]);
    const date = excelDate(r[col.date]);
    const group = groupOf(r[col.group]);
    if (invoice === '') skipped.push({ row, reason: 'noInvoice' });
    else if (date === null) skipped.push({ row, reason: 'badDate' });
    else if (group === null) skipped.push({ row, reason: 'unknownGroup' });
    else if (!(amountOf(r[col.amount]) >= MIN_AMOUNT)) skipped.push({ row, reason: 'cheap' });
    else kept.push({ date, group, author: text(r[col.author]), invoice, row });
  }
  const winners = new Set(uniqueInvoices(kept, (p) => normalizeName(p.author)));
  for (const p of kept) if (!winners.has(p)) skipped.push({ row: p.row, reason: 'duplicate' });
  const rows = [...winners]
    .map(({ date, group, author, invoice }) => ({ date, group, author, invoice }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.invoice < b.invoice ? -1 : a.invoice > b.invoice ? 1 : 0));
  return { rows, skipped: skipped.sort((a, b) => a.row - b.row) };
}

export function parsePaymentsXlsx(buf: ArrayBuffer): ReturnType<typeof parsePaymentsGrid> {
  return parsePaymentsGrid(readGrid(buf));
}
