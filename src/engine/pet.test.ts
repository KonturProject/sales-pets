import { describe, expect, test } from 'vitest';
import { defaultConfig as cfg } from './config';
import { simulate, type GroupFacts, type Override } from './pet';
import type { DayResult } from './evaluate';
import type { DateStr } from './types';

const res = (date: DateStr, longMet: boolean, qualityMet: boolean, longRequired = true): DayResult => ({
  group: 'СР1', date, normQuality: 5, normLong: 3, factQuality: 0, factLong: 0, longRequired, longMet, qualityMet,
});
const facts = (o: Partial<GroupFacts> = {}): GroupFacts => ({
  group: 'СР1', paymentsByDay: {}, results: {}, overrides: [], ...o,
});
const ov = (date: DateStr, kind: Override['kind'], delta = 1): Override => ({ date, kind, delta });

describe('яйцо', () => {
  const total = (n: number) => simulate(facts({ paymentsByDay: { '2026-11-02': n } }), '2026-11-02', cfg);
  test('фазы по числу оплат', () => {
    expect(total(0).phase).toBe('egg0');
    expect(total(1).phase).toBe('egg1');
    expect(total(2).phase).toBe('egg1');
    expect(total(3).phase).toBe('egg2');
    expect(total(4).phase).toBe('egg2');
    expect(total(5).phase).toBe('pet');
    expect(total(5).stage).toBe(0);
  });
  test('стадии роста по порогам', () => {
    expect(total(6).stage).toBe(1);
    expect(total(153).stage).toBe(15);
    expect(total(1000).stage).toBe(15);
  });
  test('оплаты накапливаются за дни и за выходные', () => {
    const s = simulate(facts({ paymentsByDay: { '2026-11-02': 2, '2026-11-03': 1, '2026-11-07': 2 } }), '2026-11-08', cfg);
    expect(s.totalPayments).toBe(5);
    expect(s.phase).toBe('pet');
  });
  test('оплаты после asOf не учитываются', () => {
    expect(simulate(facts({ paymentsByDay: { '2026-11-03': 9 } }), '2026-11-02', cfg).totalPayments).toBe(0);
  });
});

describe('награды и кучки (применяются на следующий рабочий день)', () => {
  const pay = { '2026-11-02': 6, '2026-11-03': 1, '2026-11-05': 1, '2026-11-06': 1, '2026-11-09': 1 };
  test('не выполнена норма длинных → кучка на следующий рабочий день', () => {
    const f = facts({ paymentsByDay: pay, results: { '2026-11-02': res('2026-11-02', false, false) } });
    expect(simulate(f, '2026-11-02', cfg).piles).toBe(0);
    const s = simulate(f, '2026-11-03', cfg);
    expect(s.piles).toBe(1);
    expect(s.mood).toBe('sad');
  });
  test('выполнена норма длинных: аптечка +1, кучка −1 (не ниже 0)', () => {
    const f = facts({ paymentsByDay: pay, results: { '2026-11-02': res('2026-11-02', true, true) } });
    const s = simulate(f, '2026-11-03', cfg);
    expect(s.medkits).toBe(1);
    expect(s.toys).toBe(1);
    expect(s.piles).toBe(0);
  });
  test('выполненная норма убирает одну из двух кучек', () => {
    const f = facts({
      paymentsByDay: pay,
      results: { '2026-11-02': res('2026-11-02', false, false), '2026-11-03': res('2026-11-03', false, false), '2026-11-05': res('2026-11-05', true, false) },
    });
    expect(simulate(f, '2026-11-05', cfg).piles).toBe(2);
    expect(simulate(f, '2026-11-06', cfg).piles).toBe(1);
    expect(simulate(f, '2026-11-09', cfg).piles).toBe(1); // 11-06 без результата
    const g = facts({ ...f, results: { ...f.results, '2026-11-06': res('2026-11-06', true, false) } });
    expect(simulate(g, '2026-11-09', cfg).piles).toBe(0);
  });
  test('кучек не больше maxPiles', () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11'];
    const results = Object.fromEntries(days.map((d) => [d, res(d, false, false)]));
    const p = Object.fromEntries(days.map((d) => [d, 6]));
    expect(simulate(facts({ paymentsByDay: p, results }), '2026-11-12', cfg).piles).toBe(5);
  });
  test('норма длинных не требуется → ни кучки, ни аптечки', () => {
    const f = facts({ paymentsByDay: pay, results: { '2026-11-02': res('2026-11-02', false, true, false) } });
    const s = simulate(f, '2026-11-03', cfg);
    expect(s.piles).toBe(0);
    expect(s.medkits).toBe(0);
    expect(s.toys).toBe(1);
  });
  test('понедельник: награда за пятницу применяется в понедельник', () => {
    const f = facts({ paymentsByDay: pay, results: { '2026-11-06': res('2026-11-06', true, false) } });
    expect(simulate(f, '2026-11-06', cfg).medkits).toBe(0);
    expect(simulate(f, '2026-11-09', cfg).medkits).toBe(1);
  });
  test('идемпотентность: повторный расчёт даёт тот же результат', () => {
    const f = facts({ paymentsByDay: pay, results: { '2026-11-02': res('2026-11-02', false, true) } });
    expect(simulate(f, '2026-11-09', cfg)).toEqual(simulate(f, '2026-11-09', cfg));
  });
});

describe('скука, болезнь, смерть', () => {
  test('скука: вчера оплат меньше порога, сегодня тоже', () => {
    const f = facts({ paymentsByDay: { '2026-11-02': 6 } });
    expect(simulate(f, '2026-11-03', cfg).mood).toBe('ok'); // вчера было 6
    expect(simulate(f, '2026-11-05', cfg).mood).toBe('bored'); // вчера 0 и сегодня 0
    const g = facts({ paymentsByDay: { '2026-11-02': 6, '2026-11-05': 1 } });
    expect(simulate(g, '2026-11-05', cfg).mood).toBe('ok');
  });
  test('болезнь: 2 рабочих дня подряд без оплат', () => {
    const f = facts({ paymentsByDay: { '2026-11-02': 6 } });
    // завершённые рабочие дни до 11-06: 11-03 и 11-05 без оплат
    expect(simulate(f, '2026-11-05', cfg).mood).toBe('bored');
    expect(simulate(f, '2026-11-06', cfg).mood).toBe('sick');
  });
  test('болезнь: кучек больше 4', () => {
    const pay = { '2026-11-02': 6, '2026-11-03': 1 };
    const f = facts({ paymentsByDay: pay, overrides: [ov('2026-11-03', 'piles', 5)] });
    expect(simulate(f, '2026-11-03', cfg).mood).toBe('sick');
    expect(simulate({ ...f, overrides: [ov('2026-11-03', 'piles', 4)] }, '2026-11-03', cfg).mood).toBe('sad');
  });
  test('аптечка лечит болезнь', () => {
    const base = [ov('2026-11-06', 'medkits')];
    const f = facts({ paymentsByDay: { '2026-11-02': 6 }, overrides: base });
    expect(simulate(f, '2026-11-06', cfg).mood).toBe('sick');
    const cured = simulate({ ...f, overrides: [...base, ov('2026-11-06', 'useMedkit')] }, '2026-11-06', cfg);
    expect(cured.mood).not.toBe('sick');
    expect(cured.medkits).toBe(0);
  });
  test('игрушка лечит скуку и грусть', () => {
    const o = [ov('2026-11-03', 'toys'), ov('2026-11-03', 'useToy')];
    const s = simulate(facts({ paymentsByDay: { '2026-11-02': 6 }, overrides: o }), '2026-11-03', cfg);
    expect(s.mood).toBe('ok');
    expect(s.toys).toBe(0);
  });
  test('использование без запаса ничего не меняет', () => {
    const s = simulate(facts({ paymentsByDay: { '2026-11-02': 6 }, overrides: [ov('2026-11-05', 'useToy')] }), '2026-11-05', cfg);
    expect(s.toys).toBe(0);
    expect(s.mood).toBe('bored');
  });
  test('смерть через 5 рабочих дней без оплат; со следующего рабочего дня новое яйцо', () => {
    const f = facts({ paymentsByDay: { '2026-11-02': 6 } });
    // без оплат: 11-03, 11-05, 11-06, 11-09, 11-10 → смерть в конце 11-10
    expect(simulate(f, '2026-11-10', cfg).alive).toBe(true);
    const dead = simulate(f, '2026-11-11', cfg);
    expect(dead.alive).toBe(false);
    expect(dead.mood).toBe('dead');
    const egg = simulate({ ...f, paymentsByDay: { ...f.paymentsByDay, '2026-11-12': 1 } }, '2026-11-12', cfg);
    expect(egg.alive).toBe(true);
    expect(egg.generation).toBe(1);
    expect(egg.totalPayments).toBe(1);
    expect(egg.phase).toBe('egg1');
  });
  test('яйцо не болеет и не умирает', () => {
    const s = simulate(facts({ paymentsByDay: { '2026-11-02': 2 } }), '2026-11-16', cfg);
    expect(s.alive).toBe(true);
    expect(s.generation).toBe(0);
  });
  test('пустые данные не падают', () => {
    const s = simulate(facts(), '2026-11-02', cfg);
    expect(s).toMatchObject({ phase: 'egg0', alive: true, medkits: 0, toys: 0, piles: 0, totalPayments: 0 });
    expect(simulate(facts(), '2026-10-01', cfg).phase).toBe('egg0');
  });
});

describe('сытость', () => {
  test('доля дневной нормы оплат, не больше 1', () => {
    const f = facts({ paymentsByDay: { '2026-11-02': 2 }, dailyNorm: 4 });
    expect(simulate(f, '2026-11-02', cfg).satiety).toBe(0.5);
    expect(simulate({ ...f, paymentsByDay: { '2026-11-02': 9 } }, '2026-11-02', cfg).satiety).toBe(1);
  });
});

describe('оплаты в день надгробия', () => {
  // оплаты 6 в 11-02, затем тишина: 11-03, 05, 06, 09, 10 → смерть в конце 11-10, надгробие 11-11
  const base = { '2026-11-02': 6 };
  test('первая же оплата в день надгробия показывает новое яйцо с трещинами сразу', () => {
    const s = simulate(facts({ paymentsByDay: { ...base, '2026-11-11': 2 } }), '2026-11-11', cfg);
    expect(s).toMatchObject({ alive: true, generation: 1, totalPayments: 2, phase: 'egg1' });
  });
  test('пять оплат в день надгробия — вылупление в тот же день', () => {
    const s = simulate(facts({ paymentsByDay: { ...base, '2026-11-11': 5 } }), '2026-11-11', cfg);
    expect(s).toMatchObject({ alive: true, generation: 1, phase: 'pet' });
  });
  test('без оплат надгробие стоит весь день, яйцо — со следующего', () => {
    const f = facts({ paymentsByDay: base });
    expect(simulate(f, '2026-11-11', cfg)).toMatchObject({ alive: false, mood: 'dead' });
    expect(simulate(f, '2026-11-12', cfg)).toMatchObject({ alive: true, generation: 1, phase: 'egg0' });
  });
  test('смерть в пятницу: оплата в субботу оживляет сразу, в понедельник состояние то же', () => {
    // оплаты 11-02 (6) и 11-06 (1); без оплат 11-09..11-13 → смерть в конце пятницы 11-13
    const paymentsByDay = { ...base, '2026-11-06': 1 };
    expect(simulate(facts({ paymentsByDay }), '2026-11-14', cfg)).toMatchObject({ alive: false, mood: 'dead' });
    const withSat = facts({ paymentsByDay: { ...paymentsByDay, '2026-11-14': 1 } });
    const sat = simulate(withSat, '2026-11-14', cfg);
    expect(sat).toMatchObject({ alive: true, generation: 1, totalPayments: 1, phase: 'egg1' });
    expect(simulate(withSat, '2026-11-16', cfg)).toMatchObject({ alive: true, generation: 1, totalPayments: 1, phase: 'egg1' });
  });
});
