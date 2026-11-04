import { describe, test, expect } from 'vitest';
import { loadBackend, TEST_ADMIN_PIN as PIN } from './gas-harness.mjs';
import { withFunnelImport, withPaymentsImport } from '../../src/admin/importPlan.ts';

// Предпросмотр загрузки («как будто файл уже загружен») обязан давать то же, что запишет сервер: иначе разбор покажет
// не то, что получится после «Загрузить». Здесь одна и та же загрузка идёт в зеркало и в настоящий Code.gs.
const admin = (b, extra) => {
  const reply = b.post({ pin: PIN, ...extra });
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  return reply;
};

/** Мир до загрузки: три сотрудника, воронка и оплаты за первую неделю, предварительные числа на 10–12.11. */
function seeded() {
  const b = loadBackend();
  admin(b, {
    action: 'setStaff',
    staff: [
      { name: 'Тест Альфов', group: 'СР1', baseLevel: 'experienced' },
      { name: 'Тест Бетов', group: 'СР2', baseLevel: 'rookie1' },
      { name: 'Тест Ёлкин', group: 'СР1' },
    ],
  });
  const names = ['Тест Альфов', 'Тест Бетов', 'Тест Ёлкин'];
  const rows = [];
  for (const date of ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-09']) {
    names.forEach((name, i) => rows.push({ name, date, quality: i + 1, long: i }));
  }
  admin(b, { action: 'importFunnel', through: '2026-11-09', rows });
  admin(b, {
    action: 'importPayments',
    from: '2026-11-02',
    to: '2026-11-09',
    rows: [
      { date: '2026-11-03', group: 'СР1', author: 'Тест Альфов', invoice: 'A-1' },
      { date: '2026-11-09', group: 'СР1', author: 'Тест Альфов', invoice: 'A-2' },
      { date: '2026-11-09', group: 'СР2', author: 'Тест Бетов', invoice: 'B-1' },
    ],
  });
  admin(b, { action: 'setProvisional', date: '2026-11-10', group: 'СР1', count: 3 });
  admin(b, { action: 'setProvisional', date: '2026-11-11', group: 'СР2', count: 2 });
  return b;
}

/** Сотрудники и воронка без привязки к id: у сервера это e<N>, у зеркала new:<n>. */
function byName(s) {
  const nameOf = new Map(s.staff.map((e) => [e.id, e.name]));
  const people = s.staff.map(({ id: _id, ...rest }) => rest).sort((a, b) => (a.name < b.name ? -1 : 1));
  const funnel = s.funnel.map((f) => `${nameOf.get(f.employeeId)}|${f.date}|${f.quality}|${f.long}`).sort();
  return { people, funnel, funnelThrough: s.funnelThrough };
}

describe('withFunnelImport совпадает с importFunnel и setStaff сервера', () => {
  test('замена по паре «сотрудник, день», новый сотрудник, повтор ФИО в файле, funnelThrough', () => {
    const b = seeded();
    const before = b.get();
    const rows = [
      { name: 'Тест Альфов', date: '2026-11-09', quality: 8, long: 7 }, // уже загруженный день: заменяется
      { name: 'тест  елкин', date: '2026-11-10', quality: 2, long: 2 }, // «ё»/регистр/пробелы
      { name: 'Тест Ёлкин', date: '2026-11-10', quality: 5, long: 4 }, // та же пара ещё раз: остаётся последняя
      { name: 'Тест Бетов', date: '2026-11-11', quality: 0, long: 0 },
      { name: 'Тест Гаммов', date: '2026-11-10', quality: 3, long: 1 }, // новый сотрудник
      { name: 'Тест Гаммов', date: '2026-11-11', quality: 4, long: 2 },
    ];
    const newStaff = [{ name: 'Тест Гаммов', group: 'СР5' }];
    const mirror = withFunnelImport(before, { through: '2026-11-11', rows, newStaff, outside: 0, dropped: 0, zeroThrough: false });
    admin(b, { action: 'setStaff', staff: newStaff });
    admin(b, { action: 'importFunnel', through: '2026-11-11', rows });
    expect(byName(mirror)).toEqual(byName(b.get()));
  });

  test('более ранний through: funnelThrough возвращается назад, как у сервера, строки остаются', () => {
    const b = seeded();
    const before = b.get();
    const rows = [{ name: 'Тест Альфов', date: '2026-11-05', quality: 9, long: 9 }];
    const mirror = withFunnelImport(before, { through: '2026-11-06', rows, newStaff: [], outside: 0, dropped: 0, zeroThrough: false });
    admin(b, { action: 'importFunnel', through: '2026-11-06', rows });
    expect(byName(mirror)).toEqual(byName(b.get()));
    expect(mirror.funnelThrough).toBe('2026-11-06');
  });
});

describe('withPaymentsImport совпадает с importPayments сервера', () => {
  test('период заменён, предварительные числа периода убраны, paymentsImportedThrough — максимум', () => {
    const b = seeded();
    const before = b.get();
    const rows = [
      { date: '2026-11-09', group: 'СР1', author: ' Тест Альфов ', invoice: ' A-9 ' },
      { date: '2026-11-10', group: 'СР1', author: 'Тест Альфов', invoice: 'A-10' },
      { date: '2026-11-11', group: 'СР2', author: 'Тест Бетов', invoice: 'B-11' },
      { date: '2026-11-10', group: 'СР3', author: 'Тест Чужой', invoice: 'C-10' },
    ];
    const plan = { from: '2026-11-09', to: '2026-11-11', rows, dropped: 0 };
    const mirror = withPaymentsImport(before, plan);
    admin(b, { action: 'importPayments', from: plan.from, to: plan.to, rows });
    const server = b.get();
    expect(mirror.payments).toEqual(server.payments);
    expect(mirror.provisional).toEqual(server.provisional);
    expect(mirror.paymentsImportedThrough).toBe(server.paymentsImportedThrough);
    expect(server.paymentsImportedThrough).toBe('2026-11-11');
  });

  test('период короче прежнего: paymentsImportedThrough остаётся прежним', () => {
    const b = seeded();
    const before = b.get();
    const rows = [{ date: '2026-11-03', group: 'СР1', author: 'Тест Альфов', invoice: 'A-1b' }];
    const mirror = withPaymentsImport(before, { from: '2026-11-03', to: '2026-11-03', rows, dropped: 0 });
    admin(b, { action: 'importPayments', from: '2026-11-03', to: '2026-11-03', rows });
    const server = b.get();
    expect(mirror.payments).toEqual(server.payments);
    expect(mirror.paymentsImportedThrough).toBe(server.paymentsImportedThrough);
    expect(server.paymentsImportedThrough).toBe('2026-11-09');
  });
});
