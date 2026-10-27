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
  test('расход на мёртвом питомце ничего не тратит (надгробие)', () => {
    // смерть в конце 11-10, надгробие 11-11 без оплат; запас выдан админом в тот же день
    const stock = [ov('2026-11-11', 'medkits'), ov('2026-11-11', 'toys')];
    const f = facts({ paymentsByDay: { '2026-11-02': 6 }, overrides: stock });
    const withUse = { ...f, overrides: [...stock, ov('2026-11-11', 'useMedkit'), ov('2026-11-11', 'useToy')] };
    expect(simulate(withUse, '2026-11-11', cfg)).toMatchObject({ alive: false, medkits: 1, toys: 1 });
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

describe('настройки по датам (cfgOn)', () => {
  /** Настройки `before` до даты `date` и `after` с неё; симуляция на asOf берёт настройки этой даты, как делает buildFacts. */
  const timeline = (date: DateStr, before: Partial<typeof cfg>, after: Partial<typeof cfg>) => {
    const a = { ...cfg, ...before };
    const b = { ...cfg, ...after };
    const cfgOn = (d: DateStr) => (d >= date ? b : a);
    return (f: GroupFacts, asOf: DateStr) => simulate(f, asOf, cfgOn(asOf), cfgOn);
  };
  const alive6 = { '2026-11-02': 6 };

  test('постоянный cfgOn не меняет поведения', () => {
    const f = facts({ paymentsByDay: alive6, results: { '2026-11-02': res('2026-11-02', false, true) }, overrides: [ov('2026-11-03', 'piles', 3)] });
    for (const asOf of ['2026-11-03', '2026-11-07', '2026-11-11']) {
      expect(simulate(f, asOf, cfg, () => cfg)).toEqual(simulate(f, asOf, cfg));
    }
  });

  test('maxPiles снижен с дня X: кучки срезаются до нового предела в начале X', () => {
    const run = timeline('2026-11-05', {}, { maxPiles: 2 });
    const f = facts({ paymentsByDay: alive6, overrides: [ov('2026-11-03', 'piles', 4)] });
    expect(run(f, '2026-11-03').piles).toBe(4);
    expect(run(f, '2026-11-05').piles).toBe(2);
  });

  test('maxPiles снижен: срез виден и в выходные до asOf («хвост»)', () => {
    const run = timeline('2026-11-07', {}, { maxPiles: 2 });
    const f = facts({ paymentsByDay: alive6, overrides: [ov('2026-11-03', 'piles', 4)] });
    expect(run(f, '2026-11-06').piles).toBe(4);
    expect(run(f, '2026-11-07').piles).toBe(2);
  });

  test('maxPiles поднят с дня X: прошлые дни остаются под старым пределом, задним числом не пересчитываются', () => {
    const run = timeline('2026-11-05', { maxPiles: 2 }, { maxPiles: 5 });
    const f = facts({ paymentsByDay: alive6, overrides: [ov('2026-11-03', 'piles', 4)] });
    expect(run(f, '2026-11-03').piles).toBe(2);
    expect(run(f, '2026-11-05').piles).toBe(2);
  });

  test('правка кучек в день X ограничена пределом дня X', () => {
    const run = timeline('2026-11-05', { maxPiles: 2 }, { maxPiles: 5 });
    const f = facts({ paymentsByDay: alive6, overrides: [ov('2026-11-05', 'piles', 4)] });
    expect(run(f, '2026-11-05').piles).toBe(4);
  });

  test('кучка-награда ограничена пределом того дня, в котором начисляется', () => {
    const run = timeline('2026-11-06', { maxPiles: 1 }, { maxPiles: 5 });
    const results = Object.fromEntries(['2026-11-02', '2026-11-03', '2026-11-05'].map((d) => [d, res(d, false, false)]));
    const f = facts({ paymentsByDay: alive6, results });
    expect(run(f, '2026-11-05').piles).toBe(1); // вторая кучка упёрлась в старый предел 1
    expect(run(f, '2026-11-06').piles).toBe(2); // с 06.11 предел 5
  });

  test('deathDaysNoPay снижен с дня X: серия, достигшая нового порога, убивает в первый же день по новому правилу', () => {
    const f = facts({ paymentsByDay: alive6 }); // без оплат 11-03, 05, 06, 09, 10: по умолчанию смерть в конце 11-10
    // порог 2 с 11-05: серия к концу 11-05 равна 2 → смерть в конце 11-05, в 11-06 надгробие
    const early = timeline('2026-11-05', {}, { deathDaysNoPay: 2 });
    expect(early(f, '2026-11-05').alive).toBe(true); // текущий день серию не растит
    expect(early(f, '2026-11-06').alive).toBe(false);
    // порог 2 с 11-06: к концу 11-05 серия 2 при старом пороге 5 — жив; к концу 11-06 серия 3 ≥ 2 → смерть
    const late = timeline('2026-11-06', {}, { deathDaysNoPay: 2 });
    expect(late(f, '2026-11-06').alive).toBe(true);
    expect(late(f, '2026-11-09').alive).toBe(false);
    expect(simulate(f, '2026-11-09', cfg).alive).toBe(true);
  });

  test('useMedkit срезает кучки до порога sickPilesAbove того дня, когда использована', () => {
    const run = timeline('2026-11-05', { sickPilesAbove: 4 }, { sickPilesAbove: 1 });
    const stock = [ov('2026-11-03', 'piles', 4), ov('2026-11-03', 'medkits')];
    const before = facts({ paymentsByDay: alive6, overrides: [...stock, ov('2026-11-03', 'useMedkit')] });
    const after = facts({ paymentsByDay: alive6, overrides: [...stock, ov('2026-11-05', 'useMedkit')] });
    expect(run(before, '2026-11-05').piles).toBe(4); // использована до смены: порог 4
    expect(run(after, '2026-11-05').piles).toBe(1); // использована в день смены: порог 1
  });

  test('настроение на asOf берёт настройки asOf (cfg), а не прошлых дат', () => {
    const f = facts({ paymentsByDay: alive6 }); // к 11-06 серия без оплат 2
    const strict = { ...cfg, sickDaysNoPay: 3 };
    expect(simulate(f, '2026-11-06', cfg).mood).toBe('sick');
    expect(simulate(f, '2026-11-06', strict, () => cfg).mood).toBe('bored');
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
