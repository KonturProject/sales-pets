import * as XLSX from 'xlsx';
import { describe, expect, test } from 'vitest';
import { excelDate, readGrid } from './xlsx';

describe('excelDate', () => {
  test('серийное число Excel → yyyy-MM-dd, время суток отбрасывается', () => {
    expect(excelDate(46296)).toBe('2026-10-01');
    expect(excelDate(46296.75)).toBe('2026-10-01');
    expect(excelDate(46022)).toBe('2025-12-31');
  });

  test('не число и числа вне правдоподобного окна 40000–60000 → null', () => {
    for (const v of [5, 2026.43, 99999999, NaN, Infinity, '46296', '', null, undefined]) {
      expect(excelDate(v)).toBeNull();
    }
  });
});

describe('readGrid', () => {
  const book = (sheets: Record<string, unknown[][]>): ArrayBuffer => {
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  };

  test('отдаёт числа числами, строки строками, пустые ячейки пустой строкой; индексы строк как в Excel', () => {
    const grid = readGrid(book({ A: [['x', 1.5], [], ['', 'y']] }));
    expect(grid[0]).toEqual(['x', 1.5]);
    expect(grid[1]!.every((c) => c === '')).toBe(true);
    expect(grid[2]).toEqual(['', 'y']);
  });

  test('лист, начинающийся не с A1, не сдвигает индексы', () => {
    const ws = XLSX.utils.sheet_add_aoa(XLSX.utils.aoa_to_sheet([]), [['здесь']], { origin: 'C3' });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'A');
    const grid = readGrid(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    expect(grid[2]![2]).toBe('здесь');
  });

  test('pick выбирает лист по имени; без совпадения — понятная ошибка', () => {
    const buf = book({ Первый: [['1']], Нужный: [['2']] });
    expect(readGrid(buf, (n) => n === 'Нужный')[0]).toEqual(['2']);
    expect(() => readGrid(buf, (n) => n === 'Нет такого')).toThrow('Не найден нужный лист');
  });
});
