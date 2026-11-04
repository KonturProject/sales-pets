import { describe, expect, test } from 'vitest';
import { defaultConfig } from '@/engine/config';
import type { Employee } from '@/engine/staff';
import type { ParsedFunnel } from '@/import/funnel';
import type { ImportedPayment } from '@/import/payments';
import type { Snapshot } from '@/data/api';
import { paymentsSummary, planFunnelImport, planPaymentsImport, withFunnelImport, withPaymentsImport, type FunnelPlan, type PaymentsPlan } from './importPlan';

// Игра идёт со 2 ноября 2026: 4.11 — праздник, 7–8.11 — выходные
const START = '2026-11-02';
const pay = (date: string, invoice: string): ImportedPayment => ({ date, group: 'СР1', author: 'Тест Один', invoice });

describe('planPaymentsImport', () => {
  test('период — от первой до последней даты файла; в rows только оплаты периода', () => {
    const rows = [pay('2026-11-02', 'A1'), pay('2026-11-03', 'A2'), pay('2026-11-05', 'A3')];
    expect(planPaymentsImport({ rows }, { today: '2026-11-12', startDate: START })).toEqual({ from: '2026-11-02', to: '2026-11-05', rows, dropped: 0 });
  });

  test('сегодняшние оплаты не уходят: конец периода — вчера', () => {
    const rows = [pay('2026-11-10', 'A1'), pay('2026-11-11', 'A2'), pay('2026-11-12', 'A3')];
    const plan = planPaymentsImport({ rows }, { today: '2026-11-12', startDate: START });
    expect(plan).toMatchObject({ from: '2026-11-10', to: '2026-11-11', dropped: 1 });
    expect('rows' in plan && plan.rows.map((r) => r.invoice)).toEqual(['A1', 'A2']);
  });

  test('«хвост» прошлого месяца отрезается по дате старта игры', () => {
    const rows = [pay('2026-10-30', 'A1'), pay('2026-10-31', 'A2'), pay('2026-11-02', 'A3'), pay('2026-11-03', 'A4')];
    const plan = planPaymentsImport({ rows }, { today: '2026-11-12', startDate: START });
    expect(plan).toMatchObject({ from: '2026-11-02', to: '2026-11-03', dropped: 2 });
    expect('rows' in plan && plan.rows.map((r) => r.invoice)).toEqual(['A3', 'A4']);
  });

  test('файл только за сегодня — ошибка', () => {
    const plan = planPaymentsImport({ rows: [pay('2026-11-12', 'A1')] }, { today: '2026-11-12', startDate: START });
    expect(plan).toHaveProperty('error');
  });

  test('файл целиком до старта игры и пустой файл — ошибка', () => {
    expect(planPaymentsImport({ rows: [pay('2026-10-30', 'A1')] }, { today: '2026-11-12', startDate: START })).toHaveProperty('error');
    expect(planPaymentsImport({ rows: [] }, { today: '2026-11-12', startDate: START })).toHaveProperty('error');
  });
});

const staffMember = (name: string): Employee => ({
  id: name, name, shortName: name, group: 'СР1', hireDate: null, fireDate: null,
  baseLevel: 'experienced', hiddenFromRating: false, transfers: [],
});
const funnel = (over: Partial<ParsedFunnel> = {}): ParsedFunnel => ({
  employees: [{ name: 'Тест Один', group: 'СР1' }, { name: 'Тест Два', group: 'СР5' }],
  rows: [
    { name: 'Тест Один', date: '2026-11-10', quality: 4, long: 2 },
    { name: 'Тест Один', date: '2026-11-11', quality: 5, long: 3 },
    { name: 'Тест Один', date: '2026-11-12', quality: 0, long: 0 },
    { name: 'Тест Два', date: '2026-11-11', quality: 1, long: 1 },
  ],
  firstDate: '2026-11-10',
  lastDate: '2026-11-12',
  outside: 0,
  ...over,
});
const opts = { today: '2026-11-12', config: defaultConfig };

describe('planFunnelImport', () => {
  const staff = [staffMember('Тест Один'), staffMember('Тест Два')];

  test('данные «по» предыдущий рабочий день; строки сегодняшнего дня не уходят', () => {
    const plan = planFunnelImport(funnel(), staff, opts);
    expect(plan).toMatchObject({ through: '2026-11-11', newStaff: [], outside: 0, dropped: 1 });
    expect('rows' in plan && plan.rows).toHaveLength(3);
  });

  test('понедельник: предыдущий рабочий день — пятница', () => {
    const plan = planFunnelImport(funnel({ lastDate: '2026-11-13' }), staff, { ...opts, today: '2026-11-16' });
    expect(plan).toMatchObject({ through: '2026-11-13' });
  });

  test('отчёт короче периода: данные не позже последней даты файла', () => {
    const plan = planFunnelImport(funnel({ lastDate: '2026-11-10' }), staff, opts);
    expect(plan).toMatchObject({ through: '2026-11-10' });
    expect('rows' in plan && plan.rows.map((r) => r.date)).toEqual(['2026-11-10']);
  });

  test('неизвестное ФИО даёт newStaff с группой из файла; сопоставление без регистра и лишних пробелов', () => {
    const plan = planFunnelImport(funnel(), [staffMember('  тест   один ')], opts);
    expect('newStaff' in plan && plan.newStaff).toEqual([{ name: 'Тест Два', group: 'СР5' }]);
  });

  test('ФИО дважды в файле — один новый сотрудник', () => {
    const twice = funnel({ employees: [{ name: 'Тест Три', group: 'СР1' }, { name: 'тест  три', group: 'СР1' }] });
    const plan = planFunnelImport(twice, staff, opts);
    expect('newStaff' in plan && plan.newStaff).toEqual([{ name: 'Тест Три', group: 'СР1' }]);
  });

  test('сотрудники вне игры: счётчик из парсера, на сервер их строк нет', () => {
    const plan = planFunnelImport(funnel({ outside: 3 }), staff, opts);
    expect(plan).toMatchObject({ outside: 3 });
    expect('rows' in plan && plan.rows.every((r) => ['Тест Один', 'Тест Два'].includes(r.name))).toBe(true);
  });

  test('первый день игры: дней игры в файле ещё нет — план только добавляет в штат новых из файла', () => {
    const october = funnel({ firstDate: '2026-10-29', lastDate: '2026-10-30', rows: [{ name: 'Тест Один', date: '2026-10-30', quality: 3, long: 1 }] });
    expect(planFunnelImport(october, [staffMember('тест  один')], { ...opts, today: '2026-11-02' })).toEqual({
      staffOnly: true,
      inFile: 2,
      newStaff: [{ name: 'Тест Два', group: 'СР5' }],
      outside: 0,
    });
  });

  test('ноябрьский отчёт 02.11 (колонки до конца месяца, нули) — тоже только штат; 03.11 — обычная загрузка по 02.11', () => {
    const november = funnel({
      firstDate: '2026-11-02',
      lastDate: '2026-11-30',
      rows: [{ name: 'Тест Один', date: '2026-11-02', quality: 2, long: 1 }, { name: 'Тест Один', date: '2026-11-03', quality: 0, long: 0 }],
    });
    expect(planFunnelImport(november, [], { ...opts, today: '2026-11-02' })).toMatchObject({ staffOnly: true, inFile: 2 });
    const next = planFunnelImport(november, [], { ...opts, today: '2026-11-03' });
    expect(next).toMatchObject({ through: '2026-11-02', dropped: 1, zeroThrough: false });
    expect('newStaff' in next && next.newStaff).toHaveLength(2);
  });

  test('за день «по» у всех нули (выгрузка до обновления CRM) — план это отмечает', () => {
    const stale = funnel({
      firstDate: '2026-11-02',
      lastDate: '2026-11-30',
      rows: [{ name: 'Тест Один', date: '2026-11-02', quality: 0, long: 0 }, { name: 'Тест Два', date: '2026-11-02', quality: 0, long: 0 }],
    });
    expect(planFunnelImport(stale, staff, { ...opts, today: '2026-11-03' })).toMatchObject({ through: '2026-11-02', zeroThrough: true });
  });

  test('после первого дня файл без дней игры — ошибка, а не «только штат»: октябрьский отчёт привёл бы уволенных', () => {
    const october = funnel({ firstDate: '2026-10-29', lastDate: '2026-10-30', rows: [{ name: 'Тест Новый', date: '2026-10-30', quality: 3, long: 1 }] });
    expect(planFunnelImport(october, [staffMember('Тест Один')], opts)).toEqual({ error: 'В файле нет дней игры до сегодняшнего' });
    expect(planFunnelImport(funnel({ firstDate: null, lastDate: null, rows: [] }), [], { ...opts, today: '2026-11-03' })).toEqual({ error: 'В файле нет дней игры до сегодняшнего' });
  });

  test('первый день: файл без сотрудников шести групп или все уже в штате — понятная ошибка', () => {
    const day1 = { ...opts, today: '2026-11-02' };
    expect(planFunnelImport(funnel({ employees: [] }), [], day1)).toEqual({ error: 'В файле нет сотрудников шести групп' });
    expect(planFunnelImport(funnel(), staff, day1)).toEqual({ error: 'Все сотрудники из файла уже в штате; показатели воронки загружаются со следующего рабочего дня' });
  });

  test('файл без дат или целиком до старта игры — ошибка', () => {
    expect(planFunnelImport(funnel({ firstDate: null, lastDate: null, rows: [] }), staff, opts)).toHaveProperty('error');
    expect(planFunnelImport(funnel({ lastDate: '2026-10-31' }), staff, { ...opts, today: '2026-11-02' })).toHaveProperty('error');
    expect(planFunnelImport(funnel({ lastDate: '2026-10-31' }), staff, opts)).toHaveProperty('error');
  });
});

describe('paymentsSummary: строки превью оплат', () => {
  const row = (group: ImportedPayment['group'], author: string, invoice: string): ImportedPayment => ({ date: '2026-11-03', group, author, invoice });
  const staff = [staffMember('Тест Один'), staffMember('Тест Ёлкин')];

  test('счета по группам (повтор счёта — одна оплата), все авторы найдены', () => {
    const rows = [row('СР1', 'Тест Один', 'A1'), row('СР1', 'Тест Один', 'A1'), row('СР2', ' тест  елкин ', 'B1'), row('СР2', 'Тест Ёлкин', 'B2')];
    expect(paymentsSummary(rows, staff)).toEqual([
      'По группам: СР1 1 · СР2 2 · СР3 0 · СР5 0 · СР6 0 · СР9 0',
      'Привязано к сотрудникам: 3 из 3 оплат',
    ]);
  });

  test('авторы не из штата — списком, по разу, с подсказкой', () => {
    const rows = [row('СР3', 'Новый Автор', 'C1'), row('СР3', 'Новый  Автор', 'C2'), row('СР5', 'Другой Автор', 'D1'), row('СР1', 'Тест Один', 'A1')];
    expect(paymentsSummary(rows, staff)).toEqual([
      'По группам: СР1 1 · СР2 0 · СР3 2 · СР5 1 · СР6 0 · СР9 0',
      'Привязано к сотрудникам: 1 из 4 оплат',
      'Авторы не найдены в штате (2): Другой Автор; Новый Автор. Их оплаты кормят питомца, но не идут в рейтинг: проверьте ФИО во вкладке «Сотрудники».',
    ]);
  });
});

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  version: 1, serverNow: '2026-11-12T10:00:00+03:00', funnelThrough: '2026-11-10', paymentsImportedThrough: '2026-11-10',
  config: {}, configChanges: [], staff: [], absences: [], payments: [], provisional: [], funnel: [], overrides: [], ...over,
});
const person = (id: string, name: string, group: Employee['group'] = 'СР1'): Employee => ({ ...staffMember(name), id, group });

describe('withFunnelImport: зеркало importFunnel и setStaff сервера', () => {
  const before = () => snap({
    staff: [person('e1', 'Тест Один'), person('e2', 'Тест Два', 'СР5')],
    funnel: [
      { employeeId: 'e1', date: '2026-11-09', quality: 1, long: 1 },
      { employeeId: 'e1', date: '2026-11-10', quality: 2, long: 2 },
      { employeeId: 'e2', date: '2026-11-10', quality: 3, long: 3 },
    ],
  });
  const plan = (over: Partial<FunnelPlan> = {}): FunnelPlan => ({
    through: '2026-11-11', rows: [], newStaff: [], outside: 0, dropped: 0, zeroThrough: false, ...over,
  });

  test('строки файла заменяют загруженные по паре «сотрудник, день», остальные остаются', () => {
    const after = withFunnelImport(before(), plan({
      rows: [{ name: 'Тест Один', date: '2026-11-10', quality: 9, long: 8 }, { name: 'Тест Один', date: '2026-11-11', quality: 5, long: 4 }],
    }));
    const sorted = [...after.funnel].sort((a, b) => (a.employeeId + a.date < b.employeeId + b.date ? -1 : 1));
    expect(sorted).toEqual([
      { employeeId: 'e1', date: '2026-11-09', quality: 1, long: 1 },
      { employeeId: 'e1', date: '2026-11-10', quality: 9, long: 8 },
      { employeeId: 'e1', date: '2026-11-11', quality: 5, long: 4 },
      { employeeId: 'e2', date: '2026-11-10', quality: 3, long: 3 },
    ]);
  });

  test('funnelThrough становится through, даже если он раньше прежнего: как у сервера, не максимум', () => {
    expect(withFunnelImport(before(), plan({ through: '2026-11-11' })).funnelThrough).toBe('2026-11-11');
    expect(withFunnelImport(before(), plan({ through: '2026-11-09' })).funnelThrough).toBe('2026-11-09');
  });

  test('ФИО сопоставляется без регистра, лишних пробелов и «ё»; одна пара дважды в файле — остаётся последняя строка', () => {
    const after = withFunnelImport(before(), plan({
      rows: [
        { name: 'тест  один', date: '2026-11-11', quality: 1, long: 1 },
        { name: 'Тест Один', date: '2026-11-11', quality: 7, long: 6 },
      ],
    }));
    expect(after.funnel.filter((f) => f.employeeId === 'e1' && f.date === '2026-11-11')).toEqual([{ employeeId: 'e1', date: '2026-11-11', quality: 7, long: 6 }]);
  });

  test('новые сотрудники: id new:<n>, опытные, в группе из файла, без дат и скрытия; их строки привязаны', () => {
    const after = withFunnelImport(before(), plan({
      newStaff: [{ name: '  Тест  Три ', group: 'СР3' }, { name: 'Четвёртый', group: 'СР9' }],
      rows: [{ name: 'Тест Три', date: '2026-11-11', quality: 2, long: 1 }, { name: 'Четвёртый', date: '2026-11-11', quality: 0, long: 0 }],
    }));
    expect(after.staff.slice(0, 2)).toEqual(before().staff);
    expect(after.staff.slice(2)).toEqual([
      { id: 'new:1', name: 'Тест Три', shortName: 'Тест Т.', group: 'СР3', hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [] },
      { id: 'new:2', name: 'Четвёртый', shortName: 'Четвёртый', group: 'СР9', hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [] },
    ]);
    expect(after.funnel).toContainEqual({ employeeId: 'new:1', date: '2026-11-11', quality: 2, long: 1 });
    expect(after.funnel).toContainEqual({ employeeId: 'new:2', date: '2026-11-11', quality: 0, long: 0 });
  });

  test('строки позже through не берутся; ФИО вне штата и вне newStaff сервер отклонил бы — строка пропускается', () => {
    const after = withFunnelImport(before(), plan({
      rows: [{ name: 'Тест Один', date: '2026-11-12', quality: 5, long: 5 }, { name: 'Чужой', date: '2026-11-11', quality: 5, long: 5 }],
    }));
    expect(after.funnel).toEqual(before().funnel);
  });

  test('исходный снимок не меняется (на него завязан кэш фактов), остальные поля те же', () => {
    const s = before();
    const copy = structuredClone(s);
    const after = withFunnelImport(s, plan({ rows: [{ name: 'Тест Один', date: '2026-11-10', quality: 9, long: 9 }], newStaff: [{ name: 'Тест Три', group: 'СР1' }] }));
    expect(s).toEqual(copy);
    expect(after).not.toBe(s);
    expect(after.staff).not.toBe(s.staff);
    expect(after.funnel).not.toBe(s.funnel);
    expect({ ...after, staff: 0, funnel: 0, funnelThrough: 0 }).toEqual({ ...s, staff: 0, funnel: 0, funnelThrough: 0 });
  });
});

describe('withPaymentsImport: зеркало importPayments сервера', () => {
  const p = (date: string, invoice: string, group: ImportedPayment['group'] = 'СР1', author = 'Тест Один'): ImportedPayment => ({ date, group, author, invoice });
  const before = () => snap({
    paymentsImportedThrough: '2026-11-09',
    payments: [p('2026-11-08', 'O1'), p('2026-11-09', 'O2'), p('2026-11-10', 'O3'), p('2026-11-11', 'O4')],
    provisional: [
      { date: '2026-11-09', group: 'СР1', count: 3 },
      { date: '2026-11-10', group: 'СР2', count: 4 },
      { date: '2026-11-12', group: 'СР1', count: 5 },
    ],
  });
  const plan = (over: Partial<PaymentsPlan> = {}): PaymentsPlan => ({ from: '2026-11-10', to: '2026-11-11', rows: [], dropped: 0, ...over });

  test('оплаты периода заменяются файлом, оплаты вне периода остаются; порядок как у сервера', () => {
    const after = withPaymentsImport(before(), plan({ rows: [p('2026-11-11', 'N2', 'СР2'), p('2026-11-10', 'N1')] }));
    expect(after.payments.map((r) => r.invoice)).toEqual(['O1', 'O2', 'N1', 'N2']);
    expect(after.payments.at(-1)).toMatchObject({ group: 'СР2' });
  });

  test('автор и номер счёта обрезаются по краям, как на сервере', () => {
    const after = withPaymentsImport(before(), plan({ rows: [p('2026-11-10', ' N1 ', 'СР1', ' Тест Один  ')] }));
    expect(after.payments.at(-1)).toEqual(p('2026-11-10', 'N1'));
  });

  test('предварительные числа периода убираются (в том числе другой группы), прочие остаются', () => {
    const after = withPaymentsImport(before(), plan());
    expect(after.provisional).toEqual([{ date: '2026-11-09', group: 'СР1', count: 3 }, { date: '2026-11-12', group: 'СР1', count: 5 }]);
  });

  test('paymentsImportedThrough — максимум прежнего и конца периода', () => {
    expect(withPaymentsImport(before(), plan()).paymentsImportedThrough).toBe('2026-11-11');
    expect(withPaymentsImport({ ...before(), paymentsImportedThrough: '2026-11-11' }, plan({ to: '2026-11-10' })).paymentsImportedThrough).toBe('2026-11-11');
    expect(withPaymentsImport({ ...before(), paymentsImportedThrough: null }, plan()).paymentsImportedThrough).toBe('2026-11-11');
  });

  test('исходный снимок не меняется', () => {
    const s = before();
    const copy = structuredClone(s);
    const after = withPaymentsImport(s, plan({ rows: [p('2026-11-10', 'N1')] }));
    expect(s).toEqual(copy);
    expect(after.payments).not.toBe(s.payments);
    expect(after.provisional).not.toBe(s.provisional);
  });
});
