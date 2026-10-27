import { describe, expect, test } from 'vitest';
import { countsInRating, groupOn, isPresent, levelOn, normalizeName, type Absence, type Employee } from './staff';

const emp = (o: Partial<Employee> = {}): Employee => ({
  id: 'e1', name: 'Тестов Тест Тестович', shortName: 'Тестов Т.', group: 'СР1',
  hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [], ...o,
});

describe('levelOn', () => {
  const e = emp({ hireDate: '2026-11-02', baseLevel: 'rookie1' });
  test('новичок: неделя 1, неделя 2, затем опытный', () => {
    expect(levelOn(e, '2026-11-08')).toBe('rookie1');
    expect(levelOn(e, '2026-11-09')).toBe('rookie2');
    expect(levelOn(e, '2026-11-15')).toBe('rookie2');
    expect(levelOn(e, '2026-11-16')).toBe('experienced');
  });
  test('без даты выхода уровень = базовый', () => {
    expect(levelOn(emp({ baseLevel: 'rookie2' }), '2026-11-10')).toBe('rookie2');
    expect(levelOn(emp(), '2026-11-10')).toBe('experienced');
  });
});

describe('isPresent', () => {
  const vac: Absence = { employeeId: 'e1', kind: 'vacation', from: '2026-11-10', to: '2026-11-12' };
  const open: Absence = { employeeId: 'e1', kind: 'sick', from: '2026-11-17', to: null };
  test('отпуск включает границы', () => {
    expect(isPresent(emp(), '2026-11-09', [vac])).toBe(true);
    expect(isPresent(emp(), '2026-11-10', [vac])).toBe(false);
    expect(isPresent(emp(), '2026-11-12', [vac])).toBe(false);
    expect(isPresent(emp(), '2026-11-13', [vac])).toBe(true);
  });
  test('открытое отсутствие тянется без конца', () => {
    expect(isPresent(emp(), '2026-11-20', [open])).toBe(false);
  });
  test('чужое отсутствие не влияет', () => {
    expect(isPresent(emp(), '2026-11-10', [{ ...vac, employeeId: 'other' }])).toBe(true);
  });
  test('увольнение: с даты увольнения не присутствует', () => {
    const f = emp({ fireDate: '2026-11-10' });
    expect(isPresent(f, '2026-11-09', [])).toBe(true);
    expect(isPresent(f, '2026-11-10', [])).toBe(false);
  });
  test('до приёма не присутствует', () => {
    const h = emp({ hireDate: '2026-11-05' });
    expect(isPresent(h, '2026-11-03', [])).toBe(false);
    expect(isPresent(h, '2026-11-05', [])).toBe(true);
  });
});

describe('countsInRating / groupOn', () => {
  test('скрытый не учитывается в рейтинге', () => {
    expect(countsInRating(emp({ hiddenFromRating: true }), '2026-11-03', [])).toBe(false);
    expect(countsInRating(emp(), '2026-11-03', [])).toBe(true);
  });
  test('перевод меняет группу с даты', () => {
    const e = emp({ transfers: [{ date: '2026-11-10', group: 'СР3' }] });
    expect(groupOn(e, '2026-11-09')).toBe('СР1');
    expect(groupOn(e, '2026-11-10')).toBe('СР3');
  });
  test('несколько переводов: берётся последний до даты', () => {
    const e = emp({ transfers: [{ date: '2026-11-12', group: 'СР5' }, { date: '2026-11-05', group: 'СР3' }] });
    expect(groupOn(e, '2026-11-06')).toBe('СР3');
    expect(groupOn(e, '2026-11-13')).toBe('СР5');
  });
});

describe('normalizeName', () => {
  test('убирает края, схлопывает пробелы (в т.ч. неразрывные), приводит к нижнему регистру', () => {
    expect(normalizeName('  Тестов  Тест   Тестович ')).toBe('тестов тест тестович');
    expect(normalizeName('ТЕСТОВ тест')).toBe(normalizeName('Тестов Тест'));
  });
  test('ё и е — одна буква: ФИО из разных файлов не расходятся', () => {
    expect(normalizeName('Тестов Пётр')).toBe(normalizeName('тестов петр'));
    expect(normalizeName('ЁЖИКОВ Фёдор')).toBe(normalizeName('Ежиков Федор'));
  });
});
