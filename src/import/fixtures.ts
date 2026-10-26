// Вымышленные выгрузки для проверок: тесты парсеров и tools/check-admin.mjs. В игру и админку не попадают.
import * as XLSX from 'xlsx';
import type { DateStr, GroupCode } from '@/engine/types';
import type { ImportedPayment } from './payments';

/** Серийная дата Excel: 46296 = 2026-10-01. */
export const serialOf = (d: DateStr): number => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000) + 25_569;

/** Книга из листов «имя → таблица»; ArrayBuffer — как отдаёт браузер при чтении файла. */
export function toXlsx(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, grid] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), name);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export const PAYMENTS_HEADER = ['Сумма заказа', '', '№ счета', 'Дата оплаты', 'Группа', 'Автор', ...Array(10).fill(''), 'Сумма'];

/** Строка выгрузки оплат: 17 колонок, как в файле. */
export const paymentLine = (invoice: unknown, date: unknown, group: unknown, author: unknown, amount: unknown): unknown[] => {
  const r: unknown[] = Array(17).fill('');
  r[2] = invoice; r[3] = date; r[4] = group; r[5] = author; r[16] = amount;
  return r;
};

/** Выгрузка с заголовком на заданной строке (индекс с нуля) и строками данных после него. */
export const paymentsGrid = (rows: unknown[][], headerAt = 2): unknown[][] => [
  ...Array.from({ length: headerAt }, (_, i) => [`шапка ${i}`]),
  PAYMENTS_HEADER,
  ...rows,
];

/** Файл оплат из готовых оплат: сумма у всех 500 ₽, группа вписана в длинное название отдела. */
export const paymentsXlsx = (rows: ImportedPayment[]): ArrayBuffer =>
  toXlsx({ Лист1: paymentsGrid(rows.map((r) => paymentLine(r.invoice, serialOf(r.date), `АП_НП_СР_Москва_${r.group}_ГБ_УД`, r.author, 500))) });

export interface FunnelFixtureGroup {
  group: GroupCode;
  /** показатели одинаковы в каждый день файла */
  people: { name: string; quality: number; long: number }[];
}

/**
 * Отчёт воронки: блок «Разговоры от 20 минут» и блок «Качественные счета», в каждом по колонке на день
 * и колонка недельного итога («2026.40»), которую парсер датой не считает.
 */
export function funnelXlsx(days: DateStr[], groups: FunnelFixtureGroup[]): ArrayBuffer {
  const n = days.length;
  const width = 7 + 2 * (n + 1);
  const at = (cells: Record<number, unknown>): unknown[] => Object.assign(Array(width).fill(''), cells);
  const qualityAt = 7 + n + 1;
  const header = at({ 1: 'группа', 2: 'сотр', 7: 'Разговоры от 20 минут, шт.', [qualityAt]: 'Качественные счета, шт.' });
  const dates = at({
    ...Object.fromEntries(days.map((d, i) => [7 + i, serialOf(d)])),
    [7 + n]: '2026.40',
    ...Object.fromEntries(days.map((d, i) => [qualityAt + i, serialOf(d)])),
    [qualityAt + n]: '2026.40',
  });
  const body = groups.flatMap(({ group, people }) => [
    at({ 1: 1, 6: `${group} Отдел продаж` }),
    ...people.map(({ name, quality, long }) =>
      at({
        2: 1,
        6: name,
        ...Object.fromEntries(days.map((_, i) => [7 + i, long])),
        [7 + n]: long * n,
        ...Object.fromEntries(days.map((_, i) => [qualityAt + i, quality])),
        [qualityAt + n]: quality * n,
      })),
  ]);
  return toXlsx({ 'ВОРОНКА Первичная кампания': [[], [], header, dates, ...body] });
}
