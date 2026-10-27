import { describe, test, expect } from 'vitest';
import { loadBackend, TEST_ADMIN_PIN as PIN } from './gas-harness.mjs';

// «Сегодня» во всех тестах — четверг 2026-11-12 (рабочий день), 10:00 по Москве; все ФИО вымышленные.
const GROUP_CODES = ['СР1', 'СР2', 'СР3', 'СР5', 'СР6', 'СР9'];
const MIN = 60_000;

const admin = (b, action, extra = {}) => b.post({ action, pin: PIN, ...extra });
const pay = (date, group, author, invoice) => ({ date, group, author, invoice });
const STAFF = [
  { name: 'Иванов Иван', group: 'СР1' },
  { name: 'Петров Пётр', group: 'СР1' },
  { name: 'Сидорова Анна', group: 'СР5' },
];

function withStaff() {
  const b = loadBackend();
  expect(admin(b, 'setStaff', { staff: STAFF }).ok).toBe(true);
  const id = Object.fromEntries(b.get().staff.map((e) => [e.name, e.id]));
  return { b, id };
}

describe('PIN', () => {
  test('5 неверных PIN блокируют вход на 10 минут, затем блок снимается', () => {
    const b = loadBackend();
    for (let i = 0; i < 4; i++) expect(b.post({ action: 'login', pin: '000000' })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ action: 'login', pin: '000000' }).ok).toBe(false);
    const locked = b.post({ action: 'login', pin: PIN });
    expect(locked).toMatchObject({ ok: false, error: 'locked' });
    expect(locked.retryAfterSec).toBeGreaterThan(0);
    expect(locked.retryAfterSec).toBeLessThanOrEqual(600);
    b.advance(9 * MIN);
    expect(b.post({ action: 'login', pin: PIN }).error).toBe('locked');
    b.advance(MIN + 1000);
    expect(b.post({ action: 'login', pin: PIN })).toEqual({ ok: true });
  });

  test('ошибки старше 10 минут не копятся', () => {
    const b = loadBackend();
    for (let i = 0; i < 4; i++) b.post({ action: 'login', pin: '000000' });
    b.advance(11 * MIN);
    expect(b.post({ action: 'login', pin: '000000' }).error).toBe('invalid_pin');
    expect(b.post({ action: 'login', pin: PIN })).toEqual({ ok: true });
  });

  test('верный PIN сбрасывает счётчик ошибок', () => {
    const b = loadBackend();
    for (let i = 0; i < 4; i++) b.post({ action: 'login', pin: '000000' });
    expect(b.post({ action: 'login', pin: PIN })).toEqual({ ok: true });
    for (let i = 0; i < 4; i++) expect(b.post({ action: 'login', pin: '000000' }).error).toBe('invalid_pin');
  });

  test('setGroupPins выдаёт шесть разных PIN по 6–12 цифр, отличных от админского; старые перестают работать', () => {
    const b = loadBackend();
    const first = admin(b, 'setGroupPins');
    expect(first.ok).toBe(true);
    const pins = GROUP_CODES.map((g) => first.groupPins[g]);
    expect(Object.keys(first.groupPins)).toEqual(GROUP_CODES);
    for (const p of pins) expect(p).toMatch(/^\d{6,12}$/);
    expect(new Set(pins).size).toBe(6);
    expect(pins).not.toContain(PIN);
    expect(b.post({ action: 'groupLogin', group: 'СР5', groupPin: first.groupPins['СР5'] })).toEqual({ ok: true, group: 'СР5' });
    const second = admin(b, 'setGroupPins');
    expect(b.post({ action: 'groupLogin', group: 'СР5', groupPin: first.groupPins['СР5'] }).error).toBe('invalid_pin');
    expect(b.post({ action: 'groupLogin', group: 'СР5', groupPin: second.groupPins['СР5'] })).toEqual({ ok: true, group: 'СР5' });
  });

  test('PIN группы проверяется только против заявленной группы: чужой верный PIN — invalid_pin', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    expect(b.post({ action: 'groupLogin', group: 'СР1', groupPin: groupPins['СР2'] })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ action: 'groupLogin', group: 'СР1', groupPin: groupPins['СР1'] })).toEqual({ ok: true, group: 'СР1' });
  });

  test('groupLogin без группы или с неизвестной группой — bad_request, счётчик ошибок не растёт', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    const bad = [{}, { group: 'СР4' }, { group: 5 }, { group: null }];
    for (let i = 0; i < 3; i++) {
      for (const extra of bad) {
        expect(b.post({ action: 'groupLogin', groupPin: '000000', ...extra }), JSON.stringify(extra)).toEqual({ ok: false, error: 'bad_request' });
      }
    }
    expect(b.post({ action: 'groupLogin', group: 'СР1', groupPin: groupPins['СР1'] })).toEqual({ ok: true, group: 'СР1' });
  });

  test('у каждой группы свой счётчик ошибок: пять промахов по СР1 блокируют только СР1', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    for (let i = 0; i < 4; i++) expect(b.post({ action: 'groupLogin', group: 'СР1', groupPin: '000000' }).error).toBe('invalid_pin');
    expect(b.post({ action: 'groupLogin', group: 'СР1', groupPin: '000000' }).error).toBe('locked');
    const locked = b.post({ action: 'groupLogin', group: 'СР1', groupPin: groupPins['СР1'] });
    expect(locked).toMatchObject({ ok: false, error: 'locked' });
    expect(locked.retryAfterSec).toBeGreaterThan(0);
    expect(b.post({ action: 'groupLogin', group: 'СР2', groupPin: groupPins['СР2'] })).toEqual({ ok: true, group: 'СР2' });
    b.advance(11 * MIN);
    expect(b.post({ action: 'groupLogin', group: 'СР1', groupPin: groupPins['СР1'] })).toEqual({ ok: true, group: 'СР1' });
  });

  test('вход «своей» группы не сбрасывает ошибки по чужой: перебор с собственным PIN блокируется', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    const results = [];
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) results.push(b.post({ action: 'groupLogin', group: 'СР1', groupPin: '000000' }).error);
      expect(b.post({ action: 'groupLogin', group: 'СР2', groupPin: groupPins['СР2'] }).ok).toBe(true);
    }
    expect(results).toContain('locked');
    expect(results.filter((e) => e === 'invalid_pin')).toHaveLength(4);
  });

  test('PIN группы не открывает админ-действия, админский PIN не открывает groupLogin', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    const gp = groupPins['СР1'];
    const attempts = [
      b.post({ action: 'setStaff', pin: gp, staff: STAFF }),
      b.post({ action: 'setStaff', groupPin: gp, staff: STAFF }),
      b.post({ action: 'setProvisional', groupPin: gp, date: '2026-11-11', group: 'СР1', count: 1 }),
      b.post({ action: 'setGroupPins', pin: gp }),
      b.post({ action: 'groupLogin', group: 'СР1', groupPin: PIN }),
      b.post({ action: 'groupLogin', group: 'СР1', pin: gp }),
    ];
    for (const r of attempts) expect(r).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.get().staff).toEqual([]);
  });

  test('блокировка админского PIN не блокирует вход групп, и наоборот', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    for (let i = 0; i < 5; i++) b.post({ action: 'login', pin: '000000' });
    expect(b.post({ action: 'login', pin: PIN }).error).toBe('locked');
    expect(b.post({ action: 'groupLogin', group: 'СР2', groupPin: groupPins['СР2'] })).toEqual({ ok: true, group: 'СР2' });
    b.advance(11 * MIN);
    for (let i = 0; i < 5; i++) b.post({ action: 'groupLogin', group: 'СР2', groupPin: '000000' });
    expect(b.post({ action: 'groupLogin', group: 'СР2', groupPin: groupPins['СР2'] }).error).toBe('locked');
    expect(b.post({ action: 'login', pin: PIN })).toEqual({ ok: true });
  });

  test('changePin: старый PIN перестаёт работать, слабый и совпадающий с PIN группы отвергаются', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    expect(admin(b, 'changePin', { newPin: '12' }).error).toBe('bad_request');
    expect(admin(b, 'changePin', { newPin: 'abcd' }).error).toBe('bad_request');
    expect(admin(b, 'changePin', { newPin: groupPins['СР1'] }).error).toBe('bad_request');
    expect(b.post({ action: 'changePin', pin: '000000', newPin: '7777' }).error).toBe('invalid_pin');
    expect(admin(b, 'changePin', { newPin: '7777' })).toEqual({ ok: true });
    expect(b.post({ action: 'login', pin: PIN }).error).toBe('invalid_pin');
    expect(b.post({ action: 'login', pin: '7777' })).toEqual({ ok: true });
  });

  test('initAdminPin берёт PIN из свойства INITIAL_PIN, стирает его и не перезаписывает существующий', () => {
    const b = loadBackend({ adminPin: null });
    expect(b.post({ action: 'login', pin: '5555' }).ok).toBe(false);
    b.props.set('INITIAL_PIN', '5555');
    b.run('initAdminPin');
    expect(b.props.has('INITIAL_PIN')).toBe(false);
    expect(b.post({ action: 'login', pin: '5555' })).toEqual({ ok: true });
    b.props.set('INITIAL_PIN', '9999');
    expect(() => b.run('initAdminPin')).toThrow();
    expect(b.post({ action: 'login', pin: '5555' })).toEqual({ ok: true });
  });
});

describe('GET', () => {
  test('пустой снимок: версия, московское время сервера, пустые списки', () => {
    const b = loadBackend();
    expect(b.get()).toEqual({
      ok: true,
      version: expect.any(Number),
      serverNow: '2026-11-12T10:00:00+03:00',
      funnelThrough: null,
      paymentsImportedThrough: null,
      config: {},
      staff: [],
      absences: [],
      payments: [],
      provisional: [],
      funnel: [],
      overrides: [],
    });
  });

  test('в снимке нет хешей, солей, PIN и сумм', () => {
    const { b } = withStaff();
    const { groupPins } = admin(b, 'setGroupPins');
    admin(b, 'changePin', { newPin: '7777' });
    b.post({ action: 'importPayments', pin: '7777', from: '2026-11-09', to: '2026-11-10', rows: [pay('2026-11-09', 'СР1', 'Иванов Иван', 'A-1')] });
    const raw = JSON.stringify(b.get());
    expect(raw).not.toMatch(/hash|salt|pin|amount/i);
    expect(b.props.size).toBeGreaterThan(0);
    for (const [key, value] of b.props) {
      if (key === 'SPREADSHEET_ID') continue;
      expect(raw, key).not.toContain(value);
    }
    for (const p of Object.values(groupPins)) expect(raw).not.toContain(p);
  });

  test('?since=<версия> при неизменных данных не отдаёт снимок; после записи отдаёт', () => {
    const { b } = withStaff();
    const v = b.get().version;
    const same = b.get({ since: String(v) });
    expect(same).toEqual({ ok: true, unchanged: true, version: v, serverNow: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+03:00$/) });
    expect(same.serverNow).toBe(b.get().serverNow);
    expect(b.get({ since: String(v - 1) }).staff).toHaveLength(3);
    expect(b.get({ since: 'мусор' }).staff).toHaveLength(3);
    const written = admin(b, 'setProvisional', { date: '2026-11-11', group: 'СР1', count: 1 });
    expect(written.version).toBe(v + 1);
    expect(b.get({ since: String(v) }).version).toBe(v + 1);
    expect(b.get({ since: String(v + 1) }).unchanged).toBe(true);
  });

  test('версию двигают только успешные записи с данными', () => {
    const { b } = withStaff();
    const v = b.get().version;
    b.post({ action: 'login', pin: PIN });
    admin(b, 'setGroupPins');
    admin(b, 'changePin', { newPin: PIN });
    admin(b, 'setProvisional', { date: 'мусор', group: 'СР1', count: 1 });
    b.post({ action: 'setProvisional', pin: '000000', date: '2026-11-11', group: 'СР1', count: 1 });
    admin(b, 'importPayments', { from: '2026-11-09', to: '2026-11-10', rows: [], dryRun: true });
    expect(b.get().version).toBe(v);
  });
});

describe('importPayments', () => {
  const rows = () => [
    pay('2026-11-10', 'СР5', 'Сидорова Анна', 'B-1'),
    pay('2026-11-09', 'СР1', 'Иванов Иван', 'A-2'),
    pay('2026-11-09', 'СР1', 'Иванов Иван', 'A-1'),
  ];

  test('за период заменяет оба слоя и идемпотентен', () => {
    const b = loadBackend();
    admin(b, 'setProvisional', { date: '2026-11-09', group: 'СР2', count: 3 });
    admin(b, 'setProvisional', { date: '2026-11-11', group: 'СР2', count: 2 });
    expect(admin(b, 'importPayments', { from: '2026-11-09', to: '2026-11-10', rows: rows() })).toMatchObject({ ok: true });
    const first = b.get();
    expect(first.payments).toEqual([
      pay('2026-11-09', 'СР1', 'Иванов Иван', 'A-1'),
      pay('2026-11-09', 'СР1', 'Иванов Иван', 'A-2'),
      pay('2026-11-10', 'СР5', 'Сидорова Анна', 'B-1'),
    ]);
    expect(first.provisional).toEqual([{ date: '2026-11-11', group: 'СР2', count: 2 }]);
    expect(first.paymentsImportedThrough).toBe('2026-11-10');

    admin(b, 'importPayments', { from: '2026-11-09', to: '2026-11-10', rows: rows() });
    const second = b.get();
    expect(second.payments).toEqual(first.payments);
    expect(second.provisional).toEqual(first.provisional);
    expect(second.paymentsImportedThrough).toBe('2026-11-10');
  });

  test('повторная загрузка убирает строки, которых в новом файле нет, и не трогает дни вне периода', () => {
    const b = loadBackend();
    admin(b, 'importPayments', { from: '2026-11-09', to: '2026-11-11', rows: [...rows(), pay('2026-11-11', 'СР1', 'Петров Пётр', 'C-1')] });
    admin(b, 'importPayments', { from: '2026-11-09', to: '2026-11-09', rows: [pay('2026-11-09', 'СР1', 'Иванов Иван', 'A-1')] });
    const snap = b.get();
    expect(snap.payments.map((p) => p.invoice)).toEqual(['A-1', 'B-1', 'C-1']);
    expect(snap.paymentsImportedThrough).toBe('2026-11-11');
  });

  test('номера счетов остаются текстом: ведущие нули и длинные номера не превращаются в числа', () => {
    const b = loadBackend();
    const invoices = ['000123', '2026110900001234567890'];
    admin(b, 'importPayments', {
      from: '2026-11-09',
      to: '2026-11-09',
      rows: invoices.map((n) => pay('2026-11-09', 'СР1', '123', n)),
    });
    const snap = b.get();
    expect(snap.payments.map((p) => p.invoice).sort()).toEqual([...invoices].sort());
    expect(snap.payments.map((p) => p.author)).toEqual(['123', '123']);
    expect(snap.payments.every((p) => typeof p.date === 'string' && p.date === '2026-11-09')).toBe(true);
  });

  test('пишет таблицу одним вызовом setValues, а не построчно', () => {
    const b = loadBackend();
    const many = Array.from({ length: 300 }, (_, i) => pay('2026-11-09', 'СР1', 'Иванов Иван', `N-${i}`));
    admin(b, 'importPayments', { from: '2026-11-09', to: '2026-11-09', rows: [] });
    const sheet = b.sheet('Payments');
    const before = sheet.setValuesCalls;
    expect(admin(b, 'importPayments', { from: '2026-11-09', to: '2026-11-09', rows: many }).ok).toBe(true);
    expect(sheet.setValuesCalls - before).toBeLessThanOrEqual(1);
    expect(b.get().payments).toHaveLength(300);
  });

  test('dryRun ничего не пишет и сообщает, сколько добавится и что будет заменено', () => {
    const b = loadBackend();
    admin(b, 'setProvisional', { date: '2026-11-09', group: 'СР2', count: 3 });
    admin(b, 'setProvisional', { date: '2026-11-10', group: 'СР3', count: 4 });
    admin(b, 'importPayments', { from: '2026-11-05', to: '2026-11-06', rows: [pay('2026-11-05', 'СР1', 'Иванов Иван', 'OLD-1')] });
    const before = b.get();
    const preview = admin(b, 'importPayments', { from: '2026-11-05', to: '2026-11-10', rows: rows(), dryRun: true });
    expect(preview).toEqual({ ok: true, dryRun: true, added: 3, ignored: 0, removed: 1, removedProvisional: 7 });
    expect(b.get()).toEqual(before);
  });

  test('строки вне периода (выгрузка «хвостом» за сегодня или с прошлого месяца) игнорируются и считаются в ignored', () => {
    const b = loadBackend();
    const file = [
      pay('2026-11-08', 'СР1', 'Иванов Иван', 'OLD-1'),
      pay('2026-11-09', 'СР1', 'Иванов Иван', 'A-1'),
      pay('2026-11-10', 'СР2', 'Петров Пётр', 'B-1'),
      pay('2026-11-12', 'СР1', 'Иванов Иван', 'TODAY-1'),
    ];
    const args = { from: '2026-11-09', to: '2026-11-10', rows: file };
    expect(admin(b, 'importPayments', { ...args, dryRun: true })).toMatchObject({ ok: true, added: 2, ignored: 2 });
    expect(b.get().payments).toEqual([]);
    expect(admin(b, 'importPayments', args)).toMatchObject({ ok: true, added: 2, ignored: 2 });
    expect(b.get().payments.map((p) => p.invoice)).toEqual(['A-1', 'B-1']);
    expect(b.get().paymentsImportedThrough).toBe('2026-11-10');
  });

  test('строка с мусором внутри файла по-прежнему отклоняет весь файл, даже если она вне периода', () => {
    const b = loadBackend();
    const before = b.get();
    const args = { from: '2026-11-09', to: '2026-11-10' };
    const bad = [
      [pay('2026-11-09', 'СР1', 'Иванов Иван', 'A-1'), pay('2026-02-30', 'СР1', 'Иванов Иван', 'X-1')],
      [pay('2026-11-09', 'СР1', 'Иванов Иван', 'A-1'), pay('2026-11-12', 'СР4', 'Иванов Иван', 'X-1')],
      [pay('2026-11-09', 'СР1', 'Иванов Иван', 'A-1'), pay('2026-11-12', 'СР1', 'Иванов Иван', '')],
    ];
    for (const rows of bad) expect(admin(b, 'importPayments', { ...args, rows })).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });

  test('отвергает неверный период и строки (bad_request), ничего не записывая', () => {
    const b = loadBackend();
    const before = b.get();
    const bad = [
      { from: '2026-11-09', to: '2026-11-12', rows: [] }, // to = сегодня
      { from: '2026-11-09', to: '2026-11-13', rows: [] }, // to в будущем
      { from: '2026-11-10', to: '2026-11-09', rows: [] }, // from > to
      { from: '2026-09-01', to: '2026-11-10', rows: [] }, // больше 62 дней
      { from: '2026-13-45', to: '2026-11-10', rows: [] },
      { from: 'abc', to: '2026-11-10', rows: [] },
      { from: 20261109, to: '2026-11-10', rows: [] },
      { from: '2026-11-09', to: '2026-11-10' },
      { from: '2026-11-09', to: '2026-11-10', rows: 'x' },
      { from: '2026-11-09', to: '2026-11-10', rows: [null] },
      { from: '2026-11-09', to: '2026-11-10', rows: [pay('2026-11-09', 'СР4', 'Иванов Иван', 'A-1')] }, // чужая группа
      { from: '2026-11-09', to: '2026-11-10', rows: [pay('2026-11-09', 'СР1', 'Иванов Иван', '')] },
      { from: '2026-11-09', to: '2026-11-10', rows: [pay('2026-02-30', 'СР1', 'Иванов Иван', 'A-1')] },
      { from: '2026-11-09', to: '2026-11-10', rows: [{ date: '2026-11-09', group: 'СР1', author: 5, invoice: 'A-1' }] },
    ];
    for (const body of bad) expect(admin(b, 'importPayments', body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad_request' });
    expect(admin(b, 'importPayments', { from: '2026-11-09', to: '2026-11-11', rows: [] }).ok).toBe(true);
    expect({ ...b.get(), version: 0, paymentsImportedThrough: null }).toEqual({ ...before, version: 0 });
  });
});

describe('setProvisional', () => {
  test('день до импорта принимается; повтор для той же группы и дня заменяет число', () => {
    const b = loadBackend();
    expect(admin(b, 'setProvisional', { date: '2026-11-11', group: 'СР2', count: 3 }).ok).toBe(true);
    expect(admin(b, 'setProvisional', { date: '2026-11-11', group: 'СР2', count: 5 }).ok).toBe(true);
    admin(b, 'setProvisional', { date: '2026-11-12', group: 'СР2', count: 1 });
    expect(b.get().provisional).toEqual([
      { date: '2026-11-11', group: 'СР2', count: 5 },
      { date: '2026-11-12', group: 'СР2', count: 1 },
    ]);
  });

  test('день, уже закрытый импортом файла, отвергается, следующий принимается', () => {
    const b = loadBackend();
    admin(b, 'importPayments', { from: '2026-11-09', to: '2026-11-10', rows: [] });
    expect(admin(b, 'setProvisional', { date: '2026-11-09', group: 'СР1', count: 1 })).toEqual({ ok: false, error: 'bad_request' });
    expect(admin(b, 'setProvisional', { date: '2026-11-10', group: 'СР1', count: 1 })).toEqual({ ok: false, error: 'bad_request' });
    expect(admin(b, 'setProvisional', { date: '2026-11-11', group: 'СР1', count: 1 }).ok).toBe(true);
    expect(b.get().provisional).toEqual([{ date: '2026-11-11', group: 'СР1', count: 1 }]);
  });

  test('будущий день, мусор и неверное число — bad_request', () => {
    const b = loadBackend();
    const bad = [
      { date: '2026-11-13', group: 'СР1', count: 1 },
      { date: '2026-02-30', group: 'СР1', count: 1 },
      { date: 'мусор', group: 'СР1', count: 1 },
      { date: '2026-11-11', group: 'СР4', count: 1 },
      { date: '2026-11-11', group: 'СР1', count: -1 },
      { date: '2026-11-11', group: 'СР1', count: 1.5 },
      { date: '2026-11-11', group: 'СР1', count: '3' },
      { date: '2026-11-11', group: 'СР1' },
    ];
    for (const body of bad) expect(admin(b, 'setProvisional', body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get().provisional).toEqual([]);
  });
});

describe('importFunnel', () => {
  const day = (name, date, quality, long) => ({ name, date, quality, long });

  test('ё и е — одна буква: «Петров Петр» из файла находит «Петров Пётр» штата, setStaff не плодит двойника', () => {
    const { b, id } = withStaff();
    expect(admin(b, 'importFunnel', { through: '2026-11-10', rows: [day('Петров Петр', '2026-11-09', 1, 1)] })).toMatchObject({ ok: true, added: 1 });
    expect(b.get().funnel).toEqual([{ employeeId: id['Петров Пётр'], date: '2026-11-09', quality: 1, long: 1 }]);
    expect(admin(b, 'setStaff', { staff: [{ name: 'ПЕТРОВ ПЕТР', group: 'СР1', shortName: 'Петя' }] })).toMatchObject({ ok: true, added: 0, updated: 1 });
    expect(b.get().staff).toHaveLength(3);
  });

  test('пишет факты по сотрудникам, двигает funnelThrough, повтор даёт тот же результат', () => {
    const { b, id } = withStaff();
    const rows = [
      day('Иванов Иван', '2026-11-10', 2, 3),
      day('  петров   ПЁТР ', '2026-11-09', 0, 1),
      day('Иванов Иван', '2026-11-09', 4, 5),
    ];
    expect(admin(b, 'importFunnel', { through: '2026-11-10', rows })).toMatchObject({ ok: true });
    const first = b.get();
    expect(first.funnelThrough).toBe('2026-11-10');
    expect(first.funnel).toEqual([
      { employeeId: id['Иванов Иван'], date: '2026-11-09', quality: 4, long: 5 },
      { employeeId: id['Петров Пётр'], date: '2026-11-09', quality: 0, long: 1 },
      { employeeId: id['Иванов Иван'], date: '2026-11-10', quality: 2, long: 3 },
    ]);
    admin(b, 'importFunnel', { through: '2026-11-10', rows });
    const second = b.get();
    expect(second.funnel).toEqual(first.funnel);
    expect(second.funnelThrough).toBe('2026-11-10');
  });

  test('исправленный файл перекрывает значения, а сотрудники вне файла сохраняют прежние строки', () => {
    const { b, id } = withStaff();
    admin(b, 'importFunnel', { through: '2026-11-10', rows: [day('Иванов Иван', '2026-11-09', 1, 1), day('Петров Пётр', '2026-11-09', 2, 2)] });
    admin(b, 'importFunnel', { through: '2026-11-11', rows: [day('Иванов Иван', '2026-11-09', 7, 7), day('Иванов Иван', '2026-11-11', 3, 3)] });
    const snap = b.get();
    expect(snap.funnelThrough).toBe('2026-11-11');
    expect(snap.funnel).toEqual([
      { employeeId: id['Иванов Иван'], date: '2026-11-09', quality: 7, long: 7 },
      { employeeId: id['Петров Пётр'], date: '2026-11-09', quality: 2, long: 2 },
      { employeeId: id['Иванов Иван'], date: '2026-11-11', quality: 3, long: 3 },
    ]);
  });

  test('будущие дни файла (после through, нули колонок без данных) игнорируются и считаются в ignored', () => {
    const { b, id } = withStaff();
    const rows = [
      day('Иванов Иван', '2026-11-09', 4, 5),
      day('Иванов Иван', '2026-11-11', 0, 0),
      day('Петров Пётр', '2026-11-11', 0, 0),
      day('Иванов Иван', '2026-11-30', 0, 0),
    ];
    expect(admin(b, 'importFunnel', { through: '2026-11-10', rows })).toMatchObject({ ok: true, added: 1, ignored: 3 });
    expect(b.get().funnel).toEqual([{ employeeId: id['Иванов Иван'], date: '2026-11-09', quality: 4, long: 5 }]);
    expect(b.get().funnelThrough).toBe('2026-11-10');
  });

  test('неизвестное ФИО, сегодняшний through и мусор — bad_request, ничего не пишется', () => {
    const { b } = withStaff();
    const before = b.get();
    const ok = day('Иванов Иван', '2026-11-09', 1, 1);
    const bad = [
      { through: '2026-11-10', rows: [ok, day('Неизвестный Человек', '2026-11-09', 1, 1)] },
      { through: '2026-11-10', rows: [ok, day('Неизвестный Человек', '2026-11-30', 0, 0)] },
      { through: '2026-11-12', rows: [ok] },
      { through: 'мусор', rows: [ok] },
      { through: '2026-11-10' },
      { through: '2026-11-10', rows: [null] },
      { through: '2026-11-10', rows: [day('Иванов Иван', '2026-11-09', -1, 1)] },
      { through: '2026-11-10', rows: [day('Иванов Иван', '2026-11-09', 1, 1.5)] },
      { through: '2026-11-10', rows: [day('Иванов Иван', '2026-02-30', 1, 1)] },
    ];
    for (const body of bad) expect(admin(b, 'importFunnel', body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });
});

describe('setStaff', () => {
  test('новый сотрудник получает значения по умолчанию', () => {
    const { b } = withStaff();
    expect(b.get().staff[0]).toEqual({
      id: expect.stringMatching(/^e\d+$/),
      name: 'Иванов Иван',
      shortName: 'Иванов И.',
      group: 'СР1',
      hireDate: null,
      fireDate: null,
      baseLevel: 'experienced',
      hiddenFromRating: false,
      transfers: [],
    });
  });

  test('upsert по нормализованному ФИО сохраняет id и не трогает поля, которых нет в запросе', () => {
    const { b, id } = withStaff();
    admin(b, 'setStaff', {
      staff: [{ name: 'Иванов Иван', group: 'СР1', hireDate: '2026-10-01', baseLevel: 'rookie1', hiddenFromRating: true, hiddenReason: 'декрет', transfers: [{ date: '2026-11-10', group: 'СР2' }] }],
    });
    admin(b, 'setStaff', { staff: [{ name: '  иванов   иван ', group: 'СР1' }, { name: 'Новикова Ольга', group: 'СР9' }] });
    const staff = b.get().staff;
    expect(staff).toHaveLength(4);
    const ivanov = staff.find((e) => e.name === 'Иванов Иван');
    expect(ivanov).toMatchObject({
      id: id['Иванов Иван'],
      hireDate: '2026-10-01',
      baseLevel: 'rookie1',
      hiddenFromRating: true,
      transfers: [{ date: '2026-11-10', group: 'СР2' }],
    });
    expect(new Set(staff.map((e) => e.id)).size).toBe(4);
  });

  test('null очищает дату, явное значение перезаписывает', () => {
    const { b } = withStaff();
    admin(b, 'setStaff', { staff: [{ name: 'Иванов Иван', group: 'СР1', fireDate: '2026-11-20' }] });
    expect(b.get().staff.find((e) => e.name === 'Иванов Иван').fireDate).toBe('2026-11-20');
    admin(b, 'setStaff', { staff: [{ name: 'Иванов Иван', group: 'СР3', fireDate: null }] });
    expect(b.get().staff.find((e) => e.name === 'Иванов Иван')).toMatchObject({ fireDate: null, group: 'СР3' });
  });

  test('два сотрудника с одинаковым нормализованным ФИО в одном запросе и неверные поля — bad_request', () => {
    const { b } = withStaff();
    const before = b.get();
    const bad = [
      [{ name: 'Орлов Олег', group: 'СР1' }, { name: ' орлов  ОЛЕГ', group: 'СР2' }],
      [{ name: 'Орлов Олег', group: 'СР4' }],
      [{ name: 'Орлов Олег', group: 'СР1', baseLevel: 'senior' }],
      [{ name: 'Орлов Олег', group: 'СР1', hireDate: '2026-02-30' }],
      [{ name: 'Орлов Олег', group: 'СР1', transfers: [{ date: 'x', group: 'СР2' }] }],
      [{ name: 'Орлов Олег', group: 'СР1', transfers: 'x' }],
      [{ name: '   ', group: 'СР1' }],
      [{ group: 'СР1' }],
      [1],
      [null],
    ];
    for (const staff of bad) expect(admin(b, 'setStaff', { staff }), JSON.stringify(staff)).toEqual({ ok: false, error: 'bad_request' });
    expect(admin(b, 'setStaff', {})).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });
});

describe('причина исключения из рейтинга', () => {
  const IVANOV = 'Иванов Иван';
  const hide = (b, extra = {}) => admin(b, 'setStaff', { staff: [{ name: IVANOV, group: 'СР1', hiddenFromRating: true, ...extra }] });
  const unhide = (b) => admin(b, 'setStaff', { staff: [{ name: IVANOV, group: 'СР1', hiddenFromRating: false }] });

  test('скрыть без причины нельзя: пустая, из пробелов, не строка и длиннее 200 — bad_request, ничего не пишется', () => {
    const { b } = withStaff();
    const before = b.get();
    for (const extra of [{}, { hiddenReason: '' }, { hiddenReason: '   ' }, { hiddenReason: 5 }, { hiddenReason: null }, { hiddenReason: 'а'.repeat(201) }]) {
      expect(hide(b, extra), JSON.stringify(extra)).toEqual({ ok: false, error: 'bad_request' });
    }
    expect(b.get()).toEqual(before);
    expect(hide(b, { hiddenReason: 'а'.repeat(200) }).ok).toBe(true);
    expect(b.get().staff.find((e) => e.name === IVANOV).hiddenFromRating).toBe(true);
  });

  test('GET причину не содержит, getPrivate отдаёт её по админ-PIN (обрезанную по краям)', () => {
    const { b, id } = withStaff();
    expect(hide(b, { hiddenReason: '  декрет  ' }).ok).toBe(true);
    const snapshot = b.get();
    expect(JSON.stringify(snapshot)).not.toContain('декрет');
    expect(snapshot.staff.find((e) => e.name === IVANOV)).not.toHaveProperty('hiddenReason');
    expect(admin(b, 'getPrivate')).toEqual({ ok: true, hiddenReasons: { [id[IVANOV]]: 'декрет' } });
  });

  test('getPrivate: PIN группы и неверный PIN — invalid_pin', () => {
    const { b } = withStaff();
    hide(b, { hiddenReason: 'декрет' });
    const { groupPins } = admin(b, 'setGroupPins');
    expect(b.post({ action: 'getPrivate', group: 'СР1', groupPin: groupPins['СР1'] })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ action: 'getPrivate', pin: '000000' })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ action: 'getPrivate' })).toEqual({ ok: false, error: 'invalid_pin' });
  });

  test('повторное сохранение скрытого без причины оставляет прежнюю; новая причина заменяет', () => {
    const { b, id } = withStaff();
    hide(b, { hiddenReason: 'декрет' });
    expect(hide(b).ok).toBe(true);
    expect(admin(b, 'getPrivate').hiddenReasons).toEqual({ [id[IVANOV]]: 'декрет' });
    expect(hide(b, { hiddenReason: 'стажёр' }).ok).toBe(true);
    expect(admin(b, 'getPrivate').hiddenReasons).toEqual({ [id[IVANOV]]: 'стажёр' });
  });

  test('снятие флага стирает причину, повторное скрытие требует новую', () => {
    const { b } = withStaff();
    hide(b, { hiddenReason: 'декрет' });
    expect(unhide(b).ok).toBe(true);
    expect(b.get().staff.find((e) => e.name === IVANOV).hiddenFromRating).toBe(false);
    expect(admin(b, 'getPrivate')).toEqual({ ok: true, hiddenReasons: {} });
    expect(hide(b)).toEqual({ ok: false, error: 'bad_request' });
  });

  test('причина при снятом флаге не сохраняется', () => {
    const { b } = withStaff();
    expect(admin(b, 'setStaff', { staff: [{ name: IVANOV, group: 'СР1', hiddenFromRating: false, hiddenReason: 'зря' }] }).ok).toBe(true);
    expect(admin(b, 'getPrivate').hiddenReasons).toEqual({});
  });
});

describe('setConfig', () => {
  const setConfig = (b, config) => admin(b, 'setConfig', { config });
  const thresholds = Array.from({ length: 15 }, (_, i) => (i + 1) * 5);

  test('до первой правки GET отдаёт {}; частичные правки сливаются, соседние поля не стираются, версия растёт', () => {
    const b = loadBackend();
    expect(b.get().config).toEqual({});
    const v0 = b.get().version;
    const r1 = setConfig(b, { dailyNorm: 5, maxPiles: 3 });
    expect(r1).toEqual({ ok: true, version: v0 + 1, config: { dailyNorm: 5, maxPiles: 3 } });
    const r2 = setConfig(b, { maxPiles: 4, norms: { rookie1: { quality: 2 } } });
    expect(r2.config).toEqual({ dailyNorm: 5, maxPiles: 4, norms: { rookie1: { quality: 2 } } });
    const r3 = setConfig(b, { norms: { rookie1: { long: 1 }, experienced: { quality: 6, long: 7 } }, stageThresholds: thresholds });
    expect(r3.config).toEqual({
      dailyNorm: 5,
      maxPiles: 4,
      norms: { rookie1: { quality: 2, long: 1 }, experienced: { quality: 6, long: 7 } },
      stageThresholds: thresholds,
    });
    expect(r3.version).toBe(v0 + 3);
    const snapshot = b.get();
    expect(snapshot.config).toEqual(r3.config);
    expect(snapshot.version).toBe(r3.version);
  });

  test('границы диапазонов принимаются', () => {
    const b = loadBackend();
    const edge = {
      dailyNorm: 1000,
      maxPiles: 1,
      boredomBelow: 0,
      sickDaysNoPay: 30,
      sickPilesAbove: 0,
      deathDaysNoPay: 1,
      norms: { rookie2: { quality: 0, long: 50 } },
      stageThresholds: [...thresholds.slice(0, 14), 100000],
    };
    expect(setConfig(b, edge).config).toEqual(edge);
    expect(setConfig(b, { dailyNorm: 1, maxPiles: 20, boredomBelow: 100, sickDaysNoPay: 1, sickPilesAbove: 20, deathDaysNoPay: 30 }).ok).toBe(true);
  });

  test('вне диапазона, дробные, не числа, неизвестные поля, календарь и пустая правка — bad_request, ничего не пишется', () => {
    const b = loadBackend();
    setConfig(b, { dailyNorm: 4 });
    const before = b.get();
    const bad = [
      {},
      { dailyNorm: 0 }, { dailyNorm: 1001 }, { dailyNorm: 4.5 }, { dailyNorm: '4' }, { dailyNorm: null },
      { maxPiles: 0 }, { maxPiles: 21 },
      { boredomBelow: -1 }, { boredomBelow: 101 },
      { sickDaysNoPay: 0 }, { sickDaysNoPay: 31 },
      { sickPilesAbove: -1 }, { sickPilesAbove: 21 },
      { deathDaysNoPay: 0 }, { deathDaysNoPay: 31 },
      { norms: { experienced: { quality: -1 } } },
      { norms: { experienced: { long: 51 } } },
      { norms: { rookie1: { quality: 1.5 } } },
      { norms: { senior: { quality: 1 } } },
      { norms: { rookie2: { speed: 1 } } },
      { norms: { rookie1: 3 } },
      { norms: [] },
      { norms: {} },
      { stageThresholds: thresholds.slice(1) },
      { stageThresholds: [...thresholds, 99] },
      { stageThresholds: [...thresholds.slice(0, 14), thresholds[13]] },
      { stageThresholds: [0, ...thresholds.slice(1)] },
      { stageThresholds: [...thresholds.slice(0, 14), 100001] },
      { stageThresholds: [...thresholds.slice(0, 14), 74.5] },
      { stageThresholds: 'x' },
      { startDate: '2026-11-02' }, { endDate: '2026-11-30' }, { nonWorking: [] },
      { unknown: 1 }, { dailyNorm: 5, unknown: 1 }, { __proto__: null, hasOwnProperty: 1 },
    ];
    for (const config of bad) expect(setConfig(b, config), JSON.stringify(config)).toEqual({ ok: false, error: 'bad_request' });
    for (const config of [null, [], 'x', 5, undefined]) expect(setConfig(b, config), JSON.stringify(config)).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });

  test('админ-PIN обязателен: без PIN и с PIN группы — invalid_pin', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    expect(b.post({ action: 'setConfig', config: { dailyNorm: 5 } })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ action: 'setConfig', group: 'СР1', groupPin: groupPins['СР1'], config: { dailyNorm: 5 } })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.get().config).toEqual({});
  });

  test('испорченная руками ячейка config читается как {}, а следующая правка её чинит', () => {
    const b = loadBackend();
    setConfig(b, { dailyNorm: 5 });
    const cell = b.sheet('Settings').rows.find((r) => r[0] === 'config');
    for (const garbage of ['не json', '[1,2]', '"x"', '5', 'null']) {
      cell[1] = garbage;
      expect(b.get().config, garbage).toEqual({});
    }
    expect(setConfig(b, { maxPiles: 3 }).config).toEqual({ maxPiles: 3 });
    expect(b.get().config).toEqual({ maxPiles: 3 });
  });

  test('правка config не стирает версию и соседние настройки (funnelThrough, paymentsImportedThrough)', () => {
    const { b } = withStaff();
    admin(b, 'importFunnel', { through: '2026-11-10', rows: [] });
    admin(b, 'importPayments', { from: '2026-11-09', to: '2026-11-10', rows: [] });
    setConfig(b, { dailyNorm: 6 });
    expect(b.get()).toMatchObject({ funnelThrough: '2026-11-10', paymentsImportedThrough: '2026-11-10', config: { dailyNorm: 6 } });
  });
});

describe('ручные правки и расходы РГ', () => {
  const TODAY = '2026-11-12';
  const setOverride = (b, extra = {}) => admin(b, 'setOverride', { date: TODAY, group: 'СР1', kind: 'piles', delta: 2, ...extra });
  function withGroups() {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    const use = (group, item, ref, extra = {}) => b.post({ action: 'useItem', group, groupPin: groupPins[group], item, ref, ...extra });
    return { b, groupPins, use };
  }

  test('setOverride: правка видна в GET по возрастанию id, версия растёт, служебных полей нет', () => {
    const b = loadBackend();
    expect(b.get().overrides).toEqual([]);
    const v0 = b.get().version;
    expect(setOverride(b)).toEqual({ ok: true, version: v0 + 1, id: 1 });
    expect(setOverride(b, { date: '2026-11-09', group: 'СР6', kind: 'toys', delta: -3 })).toEqual({ ok: true, version: v0 + 2, id: 2 });
    expect(b.get().overrides).toEqual([
      { id: 1, date: TODAY, group: 'СР1', kind: 'piles', delta: 2 },
      { id: 2, date: '2026-11-09', group: 'СР6', kind: 'toys', delta: -3 },
    ]);
    expect(setOverride(b, { kind: 'medkits', delta: 20 }).ok).toBe(true);
    expect(setOverride(b, { kind: 'medkits', delta: -20 }).ok).toBe(true);
  });

  test('setOverride: без PIN, с неверным и с PIN группы — invalid_pin, ничего не пишется', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    const before = b.get();
    const body = { action: 'setOverride', date: TODAY, group: 'СР1', kind: 'piles', delta: 2 };
    expect(b.post(body)).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ ...body, pin: '000000' })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ ...body, group: 'СР1', groupPin: groupPins['СР1'] })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.get()).toEqual(before);
  });

  test('setOverride: будущая дата, мусор, чужая группа и вид, delta 0/дробная/вне ±20 — bad_request, ничего не пишется', () => {
    const b = loadBackend();
    expect(setOverride(b).ok).toBe(true);
    const before = b.get();
    const bad = [
      { date: '2026-11-13' }, { date: '2026-02-30' }, { date: 'x' }, { date: undefined },
      { group: 'СР4' }, { group: undefined },
      { kind: 'useMedkit' }, { kind: 'useToy' }, { kind: 'candies' }, { kind: undefined },
      { delta: 0 }, { delta: 1.5 }, { delta: '2' }, { delta: null }, { delta: undefined }, { delta: 21 }, { delta: -21 },
    ];
    for (const extra of bad) expect(setOverride(b, extra), JSON.stringify(extra)).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });

  test('useItem: расход пишется группе из PIN на сегодняшнюю дату сервера (дата из тела игнорируется), ref в GET не попадает', () => {
    const { b, use } = withGroups();
    const v0 = b.get().version;
    expect(use('СР2', 'medkit', 'ref-abc-1', { date: '2026-11-01', delta: 99, kind: 'piles' })).toEqual({ ok: true, version: v0 + 1, id: 1 });
    expect(use('СР5', 'toy', 'ref-abc-2')).toEqual({ ok: true, version: v0 + 2, id: 2 });
    const snapshot = b.get();
    expect(snapshot.overrides).toEqual([
      { id: 1, date: TODAY, group: 'СР2', kind: 'useMedkit', delta: 1 },
      { id: 2, date: TODAY, group: 'СР5', kind: 'useToy', delta: 1 },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('ref-abc');
  });

  test('useItem: PIN одной группы за другую, админ-PIN и отсутствие PIN — invalid_pin; без группы — bad_request', () => {
    const { b, groupPins } = withGroups();
    const before = b.get();
    const body = { action: 'useItem', item: 'toy', ref: 'r1' };
    expect(b.post({ ...body, group: 'СР2', groupPin: groupPins['СР1'] })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ ...body, group: 'СР1', pin: PIN })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ ...body, group: 'СР1' })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ ...body, groupPin: groupPins['СР1'] })).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });

  test('useItem: повтор с тем же ref не плодит строку и не поднимает версию; тот же ref у другой группы — отдельный расход', () => {
    const { b, use } = withGroups();
    const first = use('СР1', 'toy', 'same-ref');
    const v1 = b.get().version;
    expect(use('СР1', 'toy', 'same-ref')).toEqual({ ok: true, version: v1, id: first.id, duplicate: true });
    expect(b.get().version).toBe(v1);
    expect(b.get().overrides).toHaveLength(1);
    expect(use('СР3', 'toy', 'same-ref')).toMatchObject({ ok: true, id: 2 });
    expect(use('СР3', 'toy', 'same-ref').duplicate).toBe(true);
    expect(b.get().overrides).toHaveLength(2);
  });

  test('useItem: не больше 20 расходов группы в день; повтор уже записанного ref допустим; на следующий день лимит снова свободен', () => {
    const { b, use } = withGroups();
    for (let i = 1; i <= 20; i++) expect(use('СР1', i % 2 ? 'toy' : 'medkit', `r${i}`).ok, `r${i}`).toBe(true);
    const before = b.get();
    expect(use('СР1', 'toy', 'r21')).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
    expect(use('СР1', 'toy', 'r5').duplicate).toBe(true);
    expect(use('СР2', 'toy', 'r21').ok).toBe(true);
    b.advance(24 * 60 * MIN);
    expect(use('СР1', 'toy', 'r21')).toMatchObject({ ok: true, id: 22 });
    expect(b.get().overrides.at(-1)).toMatchObject({ date: '2026-11-13', group: 'СР1', kind: 'useToy' });
  });

  test('useItem: ручные правки админа лимит расходов не съедают', () => {
    const { b, use } = withGroups();
    for (let i = 0; i < 25; i++) setOverride(b, { kind: 'toys', delta: 1 });
    for (let i = 1; i <= 20; i++) expect(use('СР1', 'toy', `r${i}`).ok).toBe(true);
  });

  test('useItem: предмет и ref обязательны (ref — непустая строка до 64 символов) — иначе bad_request', () => {
    const { b, use } = withGroups();
    const before = b.get();
    for (const item of ['potion', 'medkits', 'useToy', undefined, null, 5]) expect(use('СР1', item, 'r1'), String(item)).toEqual({ ok: false, error: 'bad_request' });
    for (const ref of ['', undefined, null, 5, {}, 'x'.repeat(65)]) expect(use('СР1', 'toy', ref), JSON.stringify(ref)).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
    expect(use('СР1', 'toy', 'x'.repeat(64)).ok).toBe(true);
  });

  test('useItem: блокировка после 5 неверных PIN работает и здесь; верный PIN другой группы не блокируется', () => {
    const { b, groupPins, use } = withGroups();
    const wrong = () => b.post({ action: 'useItem', group: 'СР1', groupPin: '000000', item: 'toy', ref: 'x' });
    for (let i = 0; i < 4; i++) expect(wrong().error).toBe('invalid_pin');
    expect(wrong().error).toBe('locked');
    expect(use('СР1', 'toy', 'r1')).toMatchObject({ ok: false, error: 'locked' });
    expect(use('СР2', 'toy', 'r1').ok).toBe(true);
    expect(groupPins['СР1']).toMatch(/^\d{6}$/);
    expect(b.get().overrides).toHaveLength(1);
  });
});

describe('отсутствия', () => {
  test('задним числом сохраняется и виден в GET; тот же сотрудник и начало обновляют запись', () => {
    const { b, id } = withStaff();
    const e = id['Иванов Иван'];
    expect(admin(b, 'setAbsence', { employeeId: e, kind: 'sick', from: '2026-11-03', to: null }).ok).toBe(true);
    expect(b.get().absences).toEqual([{ employeeId: e, kind: 'sick', from: '2026-11-03', to: null }]);
    admin(b, 'setAbsence', { employeeId: e, kind: 'sick', from: '2026-11-03', to: '2026-11-06' });
    admin(b, 'setAbsence', { employeeId: e, kind: 'vacation', from: '2026-11-16', to: '2026-11-20' });
    expect(b.get().absences).toEqual([
      { employeeId: e, kind: 'sick', from: '2026-11-03', to: '2026-11-06' },
      { employeeId: e, kind: 'vacation', from: '2026-11-16', to: '2026-11-20' },
    ]);
  });

  test('removeAbsence удаляет запись и безопасен при повторе', () => {
    const { b, id } = withStaff();
    const e = id['Иванов Иван'];
    admin(b, 'setAbsence', { employeeId: e, kind: 'other', from: '2026-11-03', to: '2026-11-03' });
    expect(admin(b, 'removeAbsence', { employeeId: e, from: '2026-11-03' })).toMatchObject({ ok: true, removed: 1 });
    expect(admin(b, 'removeAbsence', { employeeId: e, from: '2026-11-03' })).toMatchObject({ ok: true, removed: 0 });
    expect(b.get().absences).toEqual([]);
  });

  test('неизвестный сотрудник, вид, дата или to раньше from — bad_request', () => {
    const { b, id } = withStaff();
    const e = id['Иванов Иван'];
    const bad = [
      { employeeId: 'e999', kind: 'sick', from: '2026-11-03', to: null },
      { employeeId: e, kind: 'holiday', from: '2026-11-03', to: null },
      { employeeId: e, kind: 'sick', from: '2026-11-31', to: null },
      { employeeId: e, kind: 'sick', from: '2026-11-03', to: 'x' },
      { employeeId: e, kind: 'sick', from: '2026-11-05', to: '2026-11-03' },
      { kind: 'sick', from: '2026-11-03', to: null },
    ];
    for (const body of bad) expect(admin(b, 'setAbsence', body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad_request' });
    expect(admin(b, 'removeAbsence', { employeeId: e, from: 'x' })).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get().absences).toEqual([]);
  });
});

describe('мусорные запросы', () => {
  test('битое, пустое и не-объектное тело, неизвестное и служебное действие — bad_request', () => {
    const b = loadBackend();
    const expected = { ok: false, error: 'bad_request' };
    expect(b.postRaw('не json')).toEqual(expected);
    expect(b.postRaw('')).toEqual(expected);
    expect(b.postRaw('[]')).toEqual(expected);
    expect(b.postRaw('null')).toEqual(expected);
    expect(b.postRaw('"login"')).toEqual(expected);
    expect(b.postEmpty()).toEqual(expected);
    expect(b.post({})).toEqual(expected);
    expect(b.post({ action: 'нет такого', pin: PIN })).toEqual(expected);
    expect(b.post({ action: 'constructor', pin: PIN })).toEqual(expected);
    expect(b.post({ action: '__proto__', pin: PIN })).toEqual(expected);
    expect(b.post({ action: 'hasOwnProperty', pin: PIN })).toEqual(expected);
  });

  test('неверный PIN проверяется раньше содержимого, а PIN не попадает в ответ', () => {
    const b = loadBackend();
    expect(b.post({ action: 'importPayments', pin: '000000', from: 'мусор' })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ action: 'login' })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ action: 'login', pin: 123456 })).toEqual({ ok: false, error: 'invalid_pin' });
    const text = JSON.stringify([b.post({ action: 'login', pin: PIN }), admin(b, 'setGroupPins').ok, b.postRaw('{"pin":"' + PIN + '"')]);
    expect(text).not.toContain(PIN);
  });
});
