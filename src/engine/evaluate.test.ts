import { describe, expect, test } from 'vitest';
import { defaultConfig as cfg } from './config';
import { evaluateDay, groupPlan, paymentPlanCents, type FunnelDay } from './evaluate';
import type { Absence, Employee } from './staff';

const emp = (id: string, o: Partial<Employee> = {}): Employee => ({
  id, name: id, shortName: id, group: 'СР1', hireDate: null, fireDate: null,
  baseLevel: 'experienced', hiddenFromRating: false, transfers: [], ...o,
});
const f = (employeeId: string, quality: number, long: number, date = '2026-11-03'): FunnelDay => ({ employeeId, date, quality, long });
const D = '2026-11-03';

describe('evaluateDay', () => {
  test('2 опытных: норма 10 качественных и 6 длинных', () => {
    const r = evaluateDay('СР1', D, [emp('a'), emp('b')], [], [], cfg);
    expect(r.normQuality).toBe(10);
    expect(r.normLong).toBe(6);
  });
  test('опытный + новичок 2 (недели 3–4): 7 и 4', () => {
    const staff = [emp('a'), emp('b', { hireDate: '2026-11-02', baseLevel: 'rookie1' })];
    // 16.11: b — rookie2 (2/1)
    const r = evaluateDay('СР1', '2026-11-16', staff, [], [], cfg);
    expect(r.normQuality).toBe(7);
    expect(r.normLong).toBe(4);
  });
  test('норма выполнена по группе в сумме', () => {
    const staff = [emp('a'), emp('b')];
    const r = evaluateDay('СР1', D, staff, [], [f('a', 8, 6), f('b', 2, 0)], cfg);
    expect(r.factQuality).toBe(10);
    expect(r.factLong).toBe(6);
    expect(r.qualityMet).toBe(true);
    expect(r.longMet).toBe(true);
  });
  test('не выполнена на единицу', () => {
    const r = evaluateDay('СР1', D, [emp('a')], [], [f('a', 5, 2)], cfg);
    expect(r.qualityMet).toBe(true);
    expect(r.longMet).toBe(false);
  });
  test('отпускник не входит ни в норму, ни в факт', () => {
    const abs: Absence[] = [{ employeeId: 'b', kind: 'vacation', from: D, to: D }];
    const r = evaluateDay('СР1', D, [emp('a'), emp('b')], abs, [f('a', 5, 3), f('b', 9, 9)], cfg);
    expect(r.normQuality).toBe(5);
    expect(r.factQuality).toBe(5);
    expect(r.qualityMet && r.longMet).toBe(true);
  });
  test('сотрудник другой группы и перевод', () => {
    const staff = [emp('a'), emp('b', { group: 'СР2', transfers: [{ date: D, group: 'СР1' }] })];
    expect(evaluateDay('СР1', D, staff, [], [], cfg).normQuality).toBe(10);
    expect(evaluateDay('СР2', D, staff, [], [], cfg).normQuality).toBe(0);
  });
  test('данные воронки за другой день игнорируются', () => {
    const r = evaluateDay('СР1', D, [emp('a')], [], [f('a', 9, 9, '2026-11-02')], cfg);
    expect(r.factQuality).toBe(0);
  });
  describe('дробные нормы: сравнение в целых сотых', () => {
    const withNorms = (experienced: Partial<typeof cfg.norms.experienced>) =>
      ({ ...cfg, norms: { ...cfg.norms, experienced: { ...cfg.norms.experienced, ...experienced } } });
    const seven = Array.from({ length: 7 }, (_, i) => emp(`e${i}`));

    test('семеро опытных с нормой длинных 1,5: норма 10,5, нужно 11', () => {
      const c = withNorms({ long: 1.5 });
      expect(evaluateDay('СР1', D, seven, [], [], c).normLong).toBe(10.5);
      const ten = evaluateDay('СР1', D, seven, [], [f('e0', 0, 10)], c);
      expect(ten.longMet).toBe(false);
      expect(ten.longRequired).toBe(true);
      expect(evaluateDay('СР1', D, seven, [], [f('e0', 0, 11)], c).longMet).toBe(true);
    });
    test('три человека с нормой 0,1: ровно 0,3 (без 0,30000000000000004), факт 0 не выполняет', () => {
      const c = withNorms({ quality: 0.1, long: 0.1 });
      const three = seven.slice(0, 3);
      const r = evaluateDay('СР1', D, three, [], [], c);
      expect(r.normQuality).toBe(0.3);
      expect(r.normLong).toBe(0.3);
      expect(r.qualityMet).toBe(false);
      expect(r.longRequired).toBe(true);
      expect(evaluateDay('СР1', D, three, [], [f('e0', 1, 1)], c).qualityMet).toBe(true);
    });
    test('норма 0,29 ×3: факт 1 перекрывает 0,87', () => {
      const c = withNorms({ quality: 0.29 });
      const r = evaluateDay('СР1', D, seven.slice(0, 3), [], [f('e0', 1, 0)], c);
      expect(r.normQuality).toBe(0.87);
      expect(r.qualityMet).toBe(true);
    });
  });
  test('норма 0 (пустая группа) — ничего не выполнено', () => {
    const r = evaluateDay('СР9', D, [emp('a')], [], [], cfg);
    expect(r.normQuality).toBe(0);
    expect(r.longMet).toBe(false);
    expect(r.qualityMet).toBe(false);
  });
  test('только новичок недели 1: длинных не требуется', () => {
    const staff = [emp('a', { hireDate: '2026-11-02', baseLevel: 'rookie1' })];
    const r = evaluateDay('СР1', '2026-11-03', staff, [], [f('a', 1, 0)], cfg);
    expect(r.longRequired).toBe(false);
    expect(r.longMet).toBe(false);
    expect(r.qualityMet).toBe(true);
  });
});

describe('план оплат группы: сумма личных норм «оплат в день» по уровню', () => {
  const staff = [
    emp('a'),
    emp('b', { baseLevel: 'rookie2' }),
    emp('c', { baseLevel: 'rookie1' }),
    emp('d', { group: 'СР2' }),
    emp('e', { fireDate: '2026-11-03' }),
  ];
  const away: Absence[] = [{ employeeId: 'a', from: '2026-11-05', to: '2026-11-05', kind: 'sick' }];

  test('день: присутствующие сотрудники группы, в сотых оплаты', () => {
    expect(paymentPlanCents('СР1', D, staff, [], cfg)).toBe(30 + 10 + 0);
    expect(paymentPlanCents('СР1', '2026-11-02', staff, [], cfg)).toBe(30 + 10 + 0 + 30);
    expect(paymentPlanCents('СР1', '2026-11-05', staff, away, cfg)).toBe(10);
    expect(paymentPlanCents('СР2', D, staff, [], cfg)).toBe(30);
  });

  test('игра: все рабочие дни 02–30.11 (20), и план на день asOf', () => {
    const one = [emp('a')];
    expect(groupPlan('СР1', D, one, [], () => cfg, cfg)).toEqual({ gameCents: 20 * 30, dayCents: 30 });
  });

  test('правка нормы «с даты» меняет план только с этой даты', () => {
    const later = { ...cfg, norms: { ...cfg.norms, experienced: { ...cfg.norms.experienced, payments: 0.5 } } };
    const cfgOn = (d: string) => (d >= '2026-11-16' ? later : cfg);
    // 9 рабочих дней до 16.11 по 0.3 и 11 дней с 16.11 по 0.5
    expect(groupPlan('СР1', '2026-11-17', [emp('a')], [], cfgOn, cfg)).toEqual({ gameCents: 9 * 30 + 11 * 50, dayCents: 50 });
  });

  test('перевод между группами: дни до перевода — в план старой группы, после — новой', () => {
    const moved = [emp('a', { transfers: [{ date: '2026-11-09', group: 'СР2' }] })];
    // 4 рабочих дня до 09.11 (02, 03, 05, 06) — СР1, остальные 16 — СР2
    expect(groupPlan('СР1', D, moved, [], () => cfg, cfg).gameCents).toBe(4 * 30);
    expect(groupPlan('СР2', D, moved, [], () => cfg, cfg).gameCents).toBe(16 * 30);
  });

  test('дробные нормы складываются без ошибок округления', () => {
    const ten = Array.from({ length: 10 }, (_, i) => emp(`p${i}`));
    expect(groupPlan('СР1', D, ten, [], () => cfg, cfg).gameCents).toBe(20 * 300);
  });
});

describe('личный план оплат на месяц: × 105% по рабочим дням игры', () => {
  test('весь месяц: план × 1,05; на день — 1/20, округление один раз', () => {
    expect(groupPlan('СР1', D, [emp('a', { paymentPlan: 6 })], [], () => cfg, cfg)).toEqual({ gameCents: 630, dayCents: 32 });
  });
  test('личный план важнее нормы уровня; 0 — это план 0, а не «нет плана»', () => {
    expect(groupPlan('СР1', D, [emp('a', { paymentPlan: 0 })], [], () => cfg, cfg).gameCents).toBe(0);
    expect(groupPlan('СР1', D, [emp('a', { baseLevel: 'rookie1', paymentPlan: 2 })], [], () => cfg, cfg).gameCents).toBe(210);
  });
  test('нет поля (старый бэкенд) или null — норма уровня', () => {
    const noField = emp('a');
    expect('paymentPlan' in noField).toBe(false);
    expect(groupPlan('СР1', D, [noField], [], () => cfg, cfg).gameCents).toBe(600);
    expect(groupPlan('СР1', D, [emp('a', { paymentPlan: null })], [], () => cfg, cfg).gameCents).toBe(600);
  });
  test('приём посреди месяца: только дни после приёма (16 из 20)', () => {
    expect(groupPlan('СР1', D, [emp('a', { hireDate: '2026-11-09', paymentPlan: 2 })], [], () => cfg, cfg).gameCents).toBe(168);
  });
  test('отпуск уменьшает план на свои рабочие дни', () => {
    const away: Absence[] = [{ employeeId: 'a', from: '2026-11-23', to: '2026-11-27', kind: 'vacation' }];
    expect(groupPlan('СР1', D, [emp('a', { paymentPlan: 6 })], away, () => cfg, cfg).gameCents).toBe(Math.round((630 * 15) / 20));
  });
  test('лишний выходной: за игру всё равно план × 1,05', () => {
    const fewer = { ...cfg, nonWorking: [...cfg.nonWorking, '2026-11-30'] };
    expect(groupPlan('СР1', D, [emp('a', { paymentPlan: 6 })], [], () => fewer, fewer).gameCents).toBe(630);
  });
  test('неточные в двоичной записи планы: десять по 6,3 — ровно 66,15 оплаты, три по 1,01 — 3,18', () => {
    const many = (n: number, plan: number) => Array.from({ length: n }, (_, i) => emp(`p${i}`, { paymentPlan: plan }));
    expect(groupPlan('СР1', D, many(10, 6.3), [], () => cfg, cfg).gameCents).toBe(6615);
    expect(groupPlan('СР1', D, many(3, 1.01), [], () => cfg, cfg).gameCents).toBe(318);
  });
  test('сумма дробных сотых — целые сотые: восемь планов по 5 дают ровно 42 оплаты', () => {
    const eight = Array.from({ length: 8 }, (_, i) => emp(`p${i}`, { paymentPlan: 5 }));
    expect(groupPlan('СР1', D, eight, [], () => cfg, cfg).gameCents).toBe(4200);
  });
});
