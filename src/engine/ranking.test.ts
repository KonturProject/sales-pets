import { describe, expect, test } from 'vitest';
import { defaultConfig as cfg } from './config';
import { groupRanking, heroesOfDay, topOverall, type PaymentRow, type RankData } from './ranking';
import type { Employee } from './staff';
import type { GroupCode } from './types';

const emp = (id: string, group: GroupCode = 'СР1', o: Partial<Employee> = {}): Employee => ({
  id, name: `Тест ${id}`, shortName: `Тест ${id.toUpperCase()}.`, group,
  hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [], ...o,
});
const pay = (employeeId: string, date: string, invoice: string): PaymentRow => ({ employeeId, date, invoice });
const data = (o: Partial<RankData> = {}): RankData => ({ staff: [], absences: [], payments: [], funnel: [], cfg, ...o });
const from = '2026-11-02';
const to = '2026-11-12';

describe('рейтинг группы', () => {
  test('сортировка по числу оплат, ничья делит место', () => {
    const d = data({
      staff: [emp('a'), emp('b'), emp('c'), emp('d'), emp('x', 'СР2')],
      payments: [
        pay('a', '2026-11-02', '1'), pay('a', '2026-11-03', '2'),
        pay('b', '2026-11-02', '3'), pay('b', '2026-11-03', '4'),
        pay('c', '2026-11-02', '5'),
        pay('x', '2026-11-02', '6'), pay('x', '2026-11-03', '7'), pay('x', '2026-11-05', '8'),
      ],
    });
    const r = groupRanking('СР1', from, to, d);
    expect(r.map((x) => [x.employeeId, x.place, x.value])).toEqual([['a', 1, 2], ['b', 1, 2], ['c', 3, 1], ['d', 4, 0]]);
    expect(r[0]).toMatchObject({ name: 'Тест a', group: 'СР1' });
  });
  test('один счёт, пришедший дважды, считается один раз', () => {
    const d = data({ staff: [emp('a')], payments: [pay('a', '2026-11-02', '1'), pay('a', '2026-11-02', '1')] });
    expect(groupRanking('СР1', from, to, d)[0].value).toBe(1);
  });
  test('отсутствующий в день оплаты не получает очков; скрытый не попадает', () => {
    const d = data({
      staff: [emp('a'), emp('h', 'СР1', { hiddenFromRating: true })],
      absences: [{ employeeId: 'a', kind: 'vacation', from: '2026-11-03', to: '2026-11-03' }],
      payments: [pay('a', '2026-11-02', '1'), pay('a', '2026-11-03', '2'), pay('h', '2026-11-02', '3')],
    });
    const r = groupRanking('СР1', from, to, d);
    expect(r.map((x) => [x.employeeId, x.value])).toEqual([['a', 1]]);
  });
  test('в отпуске на конец периода — не в списке, если нет засчитанных оплат', () => {
    const d = data({
      staff: [emp('a'), emp('b')],
      absences: [{ employeeId: 'b', kind: 'sick', from: '2026-11-02', to: null }],
    });
    expect(groupRanking('СР1', from, to, d).map((x) => x.employeeId)).toEqual(['a']);
  });
  test('уволенный: в истории прошлых дней остаётся, в будущем рейтинге нет', () => {
    const d = data({
      staff: [emp('a'), emp('f', 'СР1', { fireDate: '2026-11-10' })],
      payments: [pay('f', '2026-11-05', '1'), pay('a', '2026-11-11', '2')],
    });
    expect(groupRanking('СР1', from, '2026-11-09', d).map((x) => x.employeeId)).toEqual(['f', 'a']);
    expect(groupRanking('СР1', '2026-11-10', to, d).map((x) => x.employeeId)).toEqual(['a']);
  });
  test('перевод между группами: оплаты идут в группу на дату оплаты', () => {
    const d = data({
      staff: [emp('t', 'СР1', { transfers: [{ date: '2026-11-05', group: 'СР2' }] })],
      payments: [pay('t', '2026-11-03', '1'), pay('t', '2026-11-06', '2'), pay('t', '2026-11-09', '3')],
    });
    expect(groupRanking('СР1', from, '2026-11-04', d)[0].value).toBe(1);
    expect(groupRanking('СР2', '2026-11-05', to, d)[0].value).toBe(2);
    expect(groupRanking('СР1', '2026-11-05', to, d)).toEqual([]);
  });
  test('пустые данные → []', () => {
    expect(groupRanking('СР1', from, to, data())).toEqual([]);
  });
});

describe('общий топ', () => {
  const staff = [emp('a'), emp('b', 'СР2'), emp('c', 'СР3'), emp('z', 'СР5')];
  const payments = [
    pay('a', '2026-11-02', '1'),
    pay('b', '2026-11-02', '2'), pay('b', '2026-11-03', '3'),
    pay('c', '2026-11-03', '4'),
  ];
  test('все группы, по убыванию, нули не показываются', () => {
    const r = topOverall(from, to, data({ staff, payments }));
    expect(r.map((x) => [x.employeeId, x.place, x.group])).toEqual([['b', 1, 'СР2'], ['a', 2, 'СР1'], ['c', 2, 'СР3']]);
  });
  test('не больше n строк', () => {
    expect(topOverall(from, to, data({ staff, payments }), 2)).toHaveLength(2);
  });
  test('пустые данные → []', () => {
    expect(topOverall(from, to, data())).toEqual([]);
    expect(topOverall(from, to, data({ staff }))).toEqual([]);
  });
});

describe('герои дня', () => {
  const day = '2026-11-05';
  const f = (employeeId: string, quality: number, long: number) => ({ employeeId, date: day, quality, long });
  test('процент выполнения личной нормы; при равенстве — больше оплат', () => {
    const d = data({
      staff: [emp('a'), emp('b'), emp('c'), emp('d')],
      funnel: [f('a', 5, 3), f('b', 5, 3), f('c', 4, 2), f('d', 0, 0)],
      payments: [pay('a', day, '1'), pay('b', day, '2'), pay('b', day, '3'), pay('c', day, '4')],
    });
    const r = heroesOfDay(day, d);
    expect(r.map((x) => [x.employeeId, x.place, x.value])).toEqual([['b', 1, 100], ['a', 2, 100], ['c', 3, 75]]);
  });
  test('перевыполнение одной нормы не закрывает другую', () => {
    const d = data({ staff: [emp('a')], funnel: [f('a', 9, 0)] });
    expect(heroesOfDay(day, d)[0].value).toBe(63); // 5 из 8
  });
  test('новичок оценивается по своей норме, отсутствующий и скрытый — нет', () => {
    const d = data({
      staff: [emp('n', 'СР1', { baseLevel: 'rookie1', hireDate: '2026-11-02' }), emp('v'), emp('h', 'СР1', { hiddenFromRating: true })],
      absences: [{ employeeId: 'v', kind: 'sick', from: day, to: day }],
      funnel: [f('n', 1, 0), f('v', 5, 3), f('h', 5, 3)],
    });
    expect(heroesOfDay(day, d).map((x) => [x.employeeId, x.value])).toEqual([['n', 100]]);
  });
  test('пустые данные и день без воронки → []', () => {
    expect(heroesOfDay(day, data())).toEqual([]);
    expect(heroesOfDay(day, data({ staff: [emp('a')] }))).toEqual([]);
  });
});
