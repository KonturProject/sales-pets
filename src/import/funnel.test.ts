import * as XLSX from 'xlsx';
import { describe, expect, test } from 'vitest';
import { parseFunnelGrid, parseFunnelXlsx } from './funnel';

// Мини-копия разметки реального файла (ФИО вымышленные):
// колонки 1 и 2 — флаги «группа» / «сотр», колонка 6 — подпись строки; дальше блоки метрик, каждый начинается
// подписью в строке заголовков, ниже — строка дат с недельными итогами вида 2026.40 между днями.
const HEADER = ['', 'группа', 'сотр', '', '', '', '', 'Разговоры от 20 минут, шт.', '', '', 'Доля разговоров от 20 минут', '', '', 'Качественные счета, шт.', '', '', 'Выполнение', ''];
const DATES = ['', '', '', '', '', '', '', 46296, 46297, '2026.40', 46296, 46297, 2026.43, 46296, 46297, '2026.40', 46296, 46297];

/** строка данных: флаги, подпись и три группы значений (20 минут, шум «Доля», качественные, шум «Выполнение») */
const line = (flags: [unknown, unknown], label: string, long: unknown[], quality: unknown[]): unknown[] => [
  '', flags[0], flags[1], '', '', '', label, ...long, 0.5, 0.5, 1, ...quality, 0.9, 0.9,
];
const group = (label: string) => line(['1', ''], label, ['', '', ''], ['', '', '']);
const person = (label: string, long: unknown[], quality: unknown[]) => line(['', 1], label, long, quality);

const sample = (): unknown[][] => [
  ['', '', '', '', '', '', 'Октябрь.2026'],
  [],
  [],
  [],
  HEADER,
  DATES,
  group('СР1 Отдел продаж'),
  person('Иванов Иван', [3, 2, 5], [4, 1, 5]),
  person('  Петров   Пётр ', [0, 7, 7], [2, 2, 4]),
  group('СР5 Отдел продаж'),
  person('Сидорова Анна', [1, 1, 2], [0, 3, 3]),
];

describe('parseFunnelGrid', () => {
  test('сотрудники в порядке файла, привязаны к последней группе, ФИО без лишних пробелов', () => {
    expect(parseFunnelGrid(sample()).employees).toEqual([
      { name: 'Иванов Иван', group: 'СР1' },
      { name: 'Петров Пётр', group: 'СР1' },
      { name: 'Сидорова Анна', group: 'СР5' },
    ]);
  });

  test('значения берутся из своих блоков: «Доля…» и «Выполнение» не подмешиваются', () => {
    const rows = parseFunnelGrid(sample()).rows.filter((r) => r.name === 'Иванов Иван');
    expect(rows).toEqual([
      { name: 'Иванов Иван', date: '2026-10-01', quality: 4, long: 3 },
      { name: 'Иванов Иван', date: '2026-10-02', quality: 1, long: 2 },
    ]);
  });

  test('колонки-недели (строка «2026.40» и число 2026.43) пропускаются и не становятся датой', () => {
    const p = parseFunnelGrid(sample());
    expect(new Set(p.rows.map((r) => r.date))).toEqual(new Set(['2026-10-01', '2026-10-02']));
    expect(p.rows).toHaveLength(6);
    expect(p.firstDate).toBe('2026-10-01');
    expect(p.lastDate).toBe('2026-10-02');
  });

  test('даты в заголовке принимаются строкой yyyy-MM-dd и dd.MM.yyyy, мусор пропускается', () => {
    const g = sample();
    g[5] = [...DATES];
    g[5][7] = '2026-10-05';
    g[5][8] = '06.10.2026';
    g[5][13] = '2026-10-05';
    g[5][14] = 'не дата';
    const rows = parseFunnelGrid(g).rows.filter((r) => r.name === 'Иванов Иван');
    expect(rows).toEqual([
      { name: 'Иванов Иван', date: '2026-10-05', quality: 4, long: 3 },
      { name: 'Иванов Иван', date: '2026-10-06', quality: 0, long: 2 },
    ]);
  });

  test('флаги строк принимаются и числом 1, и строкой "1"', () => {
    const g = sample();
    g[6] = line([1, ''], 'СР1 Отдел продаж', ['', '', ''], ['', '', '']);
    g[7] = line(['', '1'], 'Иванов Иван', [3, 2, 5], [4, 1, 5]);
    expect(parseFunnelGrid(g).employees.map((e) => e.name)).toEqual(['Иванов Иван', 'Петров Пётр', 'Сидорова Анна']);
  });

  test('группа вне шести и сотрудник до первой группы пропускаются', () => {
    const g = sample();
    g.splice(6, 0, person('Без Группы', [9, 9, 9], [9, 9, 9]));
    g.push(group('СР4 Чужой отдел'), person('Чужой Человек', [1, 1, 2], [1, 1, 2]));
    const p = parseFunnelGrid(g);
    expect(p.employees.map((e) => e.name)).toEqual(['Иванов Иван', 'Петров Пётр', 'Сидорова Анна']);
    expect(p.rows.some((r) => r.name === 'Без Группы' || r.name === 'Чужой Человек')).toBe(false);
  });

  test('сотрудники вне шести групп и до первой группы считаются в outside', () => {
    const g = sample();
    g.splice(6, 0, person('Без Группы', [9, 9, 9], [9, 9, 9]));
    g.push(group('СР4 Чужой отдел'), person('Чужой Человек', [1, 1, 2], [1, 1, 2]));
    expect(parseFunnelGrid(g).outside).toBe(2);
    expect(parseFunnelGrid(sample()).outside).toBe(0);
  });

  test('пустая и нечисловая ячейка — ноль; строки без флагов игнорируются', () => {
    const g = sample();
    g[7] = person('Иванов Иван', ['', 'x', ''], [null, undefined, '']);
    g.push(line(['', ''], 'Итого по отделу', [100, 100, 200], [100, 100, 200]));
    const p = parseFunnelGrid(g);
    expect(p.rows.filter((r) => r.name === 'Иванов Иван').map((r) => [r.quality, r.long])).toEqual([[0, 0], [0, 0]]);
    expect(p.employees).toHaveLength(3);
  });

  test('нет подписи метрики или колонки-флага — понятная ошибка', () => {
    const noQuality = sample();
    noQuality[4] = HEADER.map((c) => (c === 'Качественные счета, шт.' ? 'Счета' : c));
    expect(() => parseFunnelGrid(noQuality)).toThrow('Не найдена подпись «Качественные счета, шт.»');
    expect(() => parseFunnelGrid([])).toThrow('Не найдена подпись');
    const noFlag = sample();
    noFlag[4] = HEADER.map((c) => (c === 'сотр' ? '' : c));
    expect(() => parseFunnelGrid(noFlag)).toThrow('Не найдена колонка «сотр»');
  });

  test('заголовок метрики и флагов находится по тексту, без учёта регистра и лишних пробелов', () => {
    const g = sample();
    g[4] = HEADER.map((c) => (c === 'Качественные счета, шт.' ? '  качественные  СЧЕТА, шт. ' : c === 'группа' ? ' Группа ' : c));
    expect(parseFunnelGrid(g).rows).toHaveLength(6);
  });

  test('файл без сотрудников — пустой результат, даты колонок всё равно известны', () => {
    const p = parseFunnelGrid(sample().slice(0, 6));
    expect(p.employees).toEqual([]);
    expect(p.rows).toEqual([]);
    expect(p.firstDate).toBe('2026-10-01');
  });
});

describe('parseFunnelXlsx', () => {
  test('берёт лист «ВОРОНКА Первичная кампания» среди прочих', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['мусор']]), 'Прочее');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sample()), 'ВОРОНКА Первичная кампания');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const p = parseFunnelXlsx(buf);
    expect(p.employees).toHaveLength(3);
    expect(p.rows.find((r) => r.name === 'Петров Пётр' && r.date === '2026-10-02')).toEqual({
      name: 'Петров Пётр', date: '2026-10-02', quality: 2, long: 7,
    });
  });

  test('нет листа воронки — ошибка про лист', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['мусор']]), 'Прочее');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(() => parseFunnelXlsx(buf)).toThrow('Не найден нужный лист');
  });
});
