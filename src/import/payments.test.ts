import * as XLSX from 'xlsx';
import { describe, expect, test } from 'vitest';
import { paymentLine as line, paymentsGrid as grid } from './fixtures';
import { parsePaymentsGrid, parsePaymentsXlsx } from './payments';

const SR5 = 'АП_НП_СР_Москва_СР5_ГБ_УД';
/** Серийные даты Excel: 46296 = 2026-10-01, 46297 = 2026-10-02 */
const D1 = 46296;
const D2 = 46297;

describe('parsePaymentsGrid', () => {
  test('заголовок ищется по тексту: на 3-й и на 7-й строке результат одинаков', () => {
    const rows = [line('A1', D1, SR5, 'Тест Один', 500)];
    const a = parsePaymentsGrid(grid(rows, 2));
    const b = parsePaymentsGrid(grid(rows, 6));
    expect(a.rows).toEqual([{ date: '2026-10-01', group: 'СР5', author: 'Тест Один', invoice: 'A1' }]);
    expect(b).toEqual(a);
  });

  test('сумма в результат не попадает (R10)', () => {
    const { rows } = parsePaymentsGrid(grid([line('A1', D1, SR5, 'Тест Один', 777)]));
    expect(Object.keys(rows[0]!).sort()).toEqual(['author', 'date', 'group', 'invoice']);
  });

  test('счёт дешевле 100 ₽ отбрасывается как cheap, ровно 100 остаётся; номер строки — как в Excel', () => {
    const r = parsePaymentsGrid(grid([
      line('A1', D1, SR5, 'Тест Один', 99.99),
      line('A2', D1, SR5, 'Тест Один', 100),
      line('Академия', D1, SR5, 'Тест Один', 30),
    ]));
    expect(r.rows.map((x) => x.invoice)).toEqual(['A2']);
    expect(r.skipped).toEqual([{ row: 4, reason: 'cheap' }, { row: 6, reason: 'cheap' }]);
  });

  test('сумма текстом принимается; не число — cheap', () => {
    const r = parsePaymentsGrid(grid([
      line('A1', D1, SR5, 'Тест Один', '1 234,50'),
      line('A2', D1, SR5, 'Тест Один', 'нет'),
    ]));
    expect(r.rows.map((x) => x.invoice)).toEqual(['A1']);
    expect(r.skipped).toEqual([{ row: 5, reason: 'cheap' }]);
  });

  test('группа вне шести отбрасывается как unknownGroup; код берётся по регулярке СРn', () => {
    const r = parsePaymentsGrid(grid([
      line('A1', D1, 'АП_НП_СР_Москва_СР4_ГБ_УД', 'Тест Один', 500),
      line('A2', D1, 'Москва_СР4', 'Тест Один', 500),
      line('A3', D1, 'без группы', 'Тест Один', 500),
      line('A4', D1, 'АП_НП_СР_Тверь_СР9_ГБ_УД', 'Тест Один', 500),
    ]));
    expect(r.rows.map((x) => [x.invoice, x.group])).toEqual([['A4', 'СР9']]);
    expect(r.skipped.map((x) => x.reason)).toEqual(['unknownGroup', 'unknownGroup', 'unknownGroup']);
  });

  test('итоговая строка без номера счёта — noInvoice', () => {
    const total = line('', '', '', '', 12345);
    total[0] = 'Сумма заказа';
    const r = parsePaymentsGrid(grid([line('A1', D1, SR5, 'Тест Один', 500), total]));
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toEqual([{ row: 5, reason: 'noInvoice' }]);
  });

  test('дата не из серийного числа Excel или вне правдоподобного окна — badDate', () => {
    const r = parsePaymentsGrid(grid([
      line('A1', 'вчера', SR5, 'Тест Один', 500),
      line('A2', '', SR5, 'Тест Один', 500),
      line('A3', 5, SR5, 'Тест Один', 500),
      line('A4', 99999999, SR5, 'Тест Один', 500),
      line('A5', D1 + 0.75, SR5, 'Тест Один', 500),
    ]));
    expect(r.rows.map((x) => [x.invoice, x.date])).toEqual([['A5', '2026-10-01']]);
    expect(r.skipped.map((x) => x.reason)).toEqual(['badDate', 'badDate', 'badDate', 'badDate']);
  });

  test('повтор счёта: остаётся ранняя дата, остальные — duplicate', () => {
    const r = parsePaymentsGrid(grid([
      line('A1', D2, SR5, 'Тест Один', 500),
      line('A1', D1, SR5, 'Тест Два', 500),
    ]));
    expect(r.rows).toEqual([{ date: '2026-10-01', group: 'СР5', author: 'Тест Два', invoice: 'A1' }]);
    expect(r.skipped).toEqual([{ row: 4, reason: 'duplicate' }]);
  });

  test('повтор счёта в один день: остаётся меньшее нормализованное ФИО, порядок строк не важен (R2а)', () => {
    const a = line('A1', D1, SR5, '  тест   Бета ', 500);
    const b = line('A1', D1, SR5, 'Тест Альфа', 500);
    const first = parsePaymentsGrid(grid([a, b]));
    const second = parsePaymentsGrid(grid([b, a]));
    expect(first.rows).toEqual([{ date: '2026-10-01', group: 'СР5', author: 'Тест Альфа', invoice: 'A1' }]);
    expect(second.rows).toEqual(first.rows);
  });

  test('номер счёта числом и строкой с пробелами — один и тот же счёт', () => {
    const r = parsePaymentsGrid(grid([
      line(12345, D1, SR5, 'Тест Альфа', 500),
      line('12345 ', D1, SR5, 'Тест Бета', 500),
    ]));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.invoice).toBe('12345');
    expect(r.skipped).toEqual([{ row: 5, reason: 'duplicate' }]);
  });

  test('результат отсортирован по дате и номеру счёта, не по порядку в файле', () => {
    const r = parsePaymentsGrid(grid([
      line('B', D2, SR5, 'Тест Один', 500),
      line('C', D1, SR5, 'Тест Один', 500),
      line('A', D2, SR5, 'Тест Один', 500),
    ]));
    expect(r.rows.map((x) => x.invoice)).toEqual(['C', 'A', 'B']);
  });

  test('пустой файл и файл с одним заголовком дают пустой результат', () => {
    expect(parsePaymentsGrid([])).toEqual({ rows: [], skipped: [] });
    expect(parsePaymentsGrid(grid([]))).toEqual({ rows: [], skipped: [] });
  });

  test('нет нужной колонки — понятная ошибка с названием колонки', () => {
    const noInvoice = [['x', 'Дата оплаты', 'Группа', 'Автор', 'Сумма'], ['1', 2, 3, 4, 5]];
    expect(() => parsePaymentsGrid(noInvoice)).toThrow('№ счета');
    const noAuthor = [['№ счета', 'Дата оплаты', 'Группа', 'Сумма'], ['1', 2, 3, 4]];
    expect(() => parsePaymentsGrid(noAuthor)).toThrow('Автор');
  });
});

describe('parsePaymentsXlsx', () => {
  test('читает настоящий xlsx: даты — серийные числа, без часового пояса', () => {
    const ws = XLSX.utils.aoa_to_sheet(grid([line('A1', D1, SR5, 'Тест Один', 500), line('A2', D2, SR5, 'Тест Два', 250)]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Лист1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const r = parsePaymentsXlsx(buf);
    expect(r.rows.map((x) => [x.invoice, x.date, x.group, x.author])).toEqual([
      ['A1', '2026-10-01', 'СР5', 'Тест Один'],
      ['A2', '2026-10-02', 'СР5', 'Тест Два'],
    ]);
    expect(r.skipped).toEqual([]);
  });
});
