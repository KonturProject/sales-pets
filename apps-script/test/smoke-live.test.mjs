import { describe, expect, it } from 'vitest';
import { smoke } from '../../tools/smoke-live.mjs';

const snapshot = (patch = {}) => ({
  ok: true, version: 7, serverNow: '2026-11-12T08:00:00.000Z', funnelThrough: null, paymentsImportedThrough: null,
  config: {}, configChanges: [], staff: [{ id: 'e1', name: 'Тест Один', group: 'СР1' }], absences: [], payments: [], funnel: [], overrides: [],
  ...patch,
});

/** Подменяет fetch: GET отдаёт снимок, GET с since — «без изменений», POST — ответ `post`. */
function fakeFetch({ get = snapshot(), post = { ok: false, error: 'bad_request' }, unchanged = { ok: true, unchanged: true, version: 7 } } = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    const body = init?.method === 'POST' ? post : String(url).includes('since=') ? unchanged : get;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { status: 200, text: async () => text, headers: new Headers({ 'access-control-allow-origin': '*' }) };
  };
  return { fetchFn, calls };
}

describe('smoke-live', () => {
  it('чистый снимок и bad_request на неизвестное действие: провалов нет', async () => {
    const { fetchFn, calls } = fakeFetch();
    const r = await smoke('https://example.test/exec', { fetchFn });
    expect(r.failures).toEqual([]);
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET', 'POST']);
    expect(JSON.parse(calls[2].body)).toEqual({ action: '__smoke__' });
  });

  it('запрещённый ключ в публичном ответе (причина исключения у сотрудника) — провал с путём, без значения', async () => {
    const { fetchFn } = fakeFetch({ get: snapshot({ staff: [{ id: 'e1', name: 'Тест Один', group: 'СР1', hiddenReason: 'секрет-значение' }] }) });
    const r = await smoke('https://example.test/exec', { fetchFn });
    expect(r.failures.join('\n')).toContain('staff[].hiddenReason');
    expect(r.failures.join('\n')).not.toContain('секрет-значение');
  });

  it.each(['pin', 'groupPin', 'hash', 'salt', 'amount', 'sum', 'ref'])('ключ %s в оплатах или правках — провал', async (key) => {
    const { fetchFn } = fakeFetch({ get: snapshot({ overrides: [{ id: 1, [key]: 'x' }] }) });
    expect((await smoke('https://example.test/exec', { fetchFn })).failures.join('\n')).toContain(`overrides[].${key}`);
  });

  it('нет обязательного массива — провал', async () => {
    const bad = snapshot();
    delete bad.configChanges;
    const { fetchFn } = fakeFetch({ get: bad });
    expect((await smoke('https://example.test/exec', { fetchFn })).failures.join('\n')).toContain('configChanges');
  });

  it('страница входа Google вместо JSON — провал «не JSON»', async () => {
    const { fetchFn } = fakeFetch({ get: '<!doctype html><title>Sign in</title>' });
    expect((await smoke('https://example.test/exec', { fetchFn })).failures.join('\n')).toContain('не JSON');
  });

  it('неизвестное действие принято (ok: true) — провал', async () => {
    const { fetchFn } = fakeFetch({ post: { ok: true } });
    expect((await smoke('https://example.test/exec', { fetchFn })).failures.join('\n')).toContain('bad_request');
  });

  it('сбой сети не падает с исключением', async () => {
    const r = await smoke('https://example.test/exec', { fetchFn: async () => { throw new Error('boom'); } });
    expect(r.failures).toEqual(['сеть: boom']);
  });
});
