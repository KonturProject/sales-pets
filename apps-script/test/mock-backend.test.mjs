import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildDemo } from '@/demo/demoFacts';
import { MOCK_ADMIN_PIN, startMockBackend } from '../../tools/mock-backend.mjs';

const DEMO_DAY = '2026-11-12';
const THROUGH = '2026-11-11';
const demo = buildDemo(DEMO_DAY);

let mock;
beforeAll(async () => {
  mock = await startMockBackend({ port: 0 });
}, 60_000);
afterAll(() => mock?.close());

const snapshot = (query = '') => fetch(mock.url + query).then((r) => r.json());
const post = (body) =>
  fetch(mock.url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then((r) => r.json());

describe('мок-бэкенд', () => {
  test('отдаёт демо-снимок на 12 ноября: штат, «сейчас» и границы слоёв', async () => {
    const s = await snapshot();
    expect(s.ok).toBe(true);
    expect(s.serverNow.slice(0, 10)).toBe(DEMO_DAY);
    expect(s.funnelThrough).toBe(THROUGH);
    expect(s.paymentsImportedThrough).toBe(THROUGH);
    expect(s.staff).toHaveLength(demo.staff.length);
    for (const group of new Set(demo.staff.map((e) => e.group))) {
      expect(s.staff.filter((e) => e.group === group)).toHaveLength(demo.staff.filter((e) => e.group === group).length);
    }
  });

  test('оплаты до вчера лежат строками, оплаты сегодняшнего дня — предварительными числами', async () => {
    const s = await snapshot();
    for (const [group, byDay] of Object.entries(demo.paymentsByGroup)) {
      for (const [date, count] of Object.entries(byDay)) {
        if (date <= THROUGH) {
          expect(s.payments.filter((p) => p.group === group && p.date === date)).toHaveLength(count);
        } else {
          expect(s.provisional.find((p) => p.group === group && p.date === date)?.count).toBe(count);
        }
      }
    }
    expect(s.payments.every((p) => p.date <= THROUGH)).toBe(true);
  });

  test('воронка — по сотруднику и дню, только до вчера', async () => {
    const s = await snapshot();
    expect(s.funnel).toHaveLength(demo.funnel.filter((r) => r.date <= THROUGH).length);
    expect(s.funnel.every((r) => r.date <= THROUGH)).toBe(true);
  });

  test('пускает с мок-PIN админа и отказывает с чужим', async () => {
    expect((await post({ action: 'login', pin: MOCK_ADMIN_PIN })).ok).toBe(true);
    expect(await post({ action: 'login', pin: '9999' })).toEqual({ ok: false, error: 'invalid_pin' });
  });

  test('выдаёт PIN шести групп: groupLogin с выданным PIN проходит, с чужим — нет', async () => {
    expect(Object.keys(mock.groupPins).sort()).toEqual(['СР1', 'СР2', 'СР3', 'СР5', 'СР6', 'СР9']);
    expect(await post({ action: 'groupLogin', group: 'СР1', groupPin: mock.groupPins['СР1'] })).toMatchObject({ ok: true, group: 'СР1' });
    expect(await post({ action: 'groupLogin', group: 'СР2', groupPin: mock.groupPins['СР1'] })).toEqual({ ok: false, error: 'invalid_pin' });
  });

  test('отвечает странице с другого адреса (CORS) и на предзапрос', async () => {
    const res = await fetch(mock.url);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const preflight = await fetch(mock.url, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
  });

  test('при неизменной версии отвечает unchanged', async () => {
    const { version } = await snapshot();
    expect(await snapshot(`?since=${version}`)).toEqual({ ok: true, unchanged: true, version });
  });
});
