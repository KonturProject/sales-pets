import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError, createApi, resolveBackend, resolvePollMs, serverToday, type Snapshot } from './api';

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);
const BASE = 'https://script.example/exec';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('serverToday', () => {
  test('дата из московского времени сервера, а не из часов машины', () => {
    const at = (serverNow: string) => serverToday({ serverNow } as Snapshot);
    expect(at('2026-11-12T10:00:00+03:00')).toBe('2026-11-12');
    expect(at('2026-11-12T00:05:00+03:00')).toBe('2026-11-12');
    expect(at('2026-11-12T23:59:59+03:00')).toBe('2026-11-12');
  });
});

describe('api.get', () => {
  test('идёт без cookie, ?since= добавляется только с версией; ответ отдаётся как есть', async () => {
    const fetchFn = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(json({ ok: true, version: 3 })));
    const api = createApi({ url: () => BASE, fetchFn });
    expect(await api.get()).toMatchObject({ version: 3 });
    await api.get(3);
    expect(fetchFn.mock.calls[0][0]).toBe(BASE);
    expect(fetchFn.mock.calls[1][0]).toBe(`${BASE}?since=3`);
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
    expect(vi.getTimerCount()).toBe(0); // таймер таймаута снят
  });

  test('{unchanged:true} отдаётся как «без изменений» с версией и «сейчас» сервера', async () => {
    const serverNow = '2026-11-12T10:00:00+03:00';
    const api = createApi({ url: () => BASE, fetchFn: vi.fn().mockResolvedValue(json({ ok: true, unchanged: true, version: 3, serverNow })) });
    expect(await api.get(3)).toEqual({ unchanged: true, version: 3, serverNow });
  });
});

describe('api.post', () => {
  test('тело — JSON с action, заголовок text/plain, без cookie; ответ отдаётся как есть', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ ok: true, group: 'СР1' }));
    const api = createApi({ url: () => BASE, fetchFn });
    expect(await api.post('groupLogin', { group: 'СР1', groupPin: '123456' })).toEqual({ ok: true, group: 'СР1' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(BASE);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(init.headers['content-type']).toMatch(/^text\/plain/);
    expect(JSON.parse(init.body)).toEqual({ action: 'groupLogin', group: 'СР1', groupPin: '123456' });
  });
});

describe('ошибки', () => {
  test('ok:false превращается в ApiError с кодом сервера и retryAfterSec', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ ok: false, error: 'locked', retryAfterSec: 600 }));
    const err = (await createApi({ url: () => BASE, fetchFn }).post('login', { pin: '0000' }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'locked', retryAfterSec: 600 });
    expect(err.message).not.toContain('0000');
  });

  test('незнакомый код сервера считается server_error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ ok: false, error: 'что-то новое' }));
    await expect(createApi({ url: () => BASE, fetchFn }).get()).rejects.toMatchObject({ code: 'server_error' });
  });

  test.each([
    ['сеть недоступна', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['не JSON', () => Promise.resolve(new Response('<html>oops</html>'))],
    ['HTTP 500', () => Promise.resolve(json({ ok: false }, { status: 500 }))],
  ])('%s → ApiError network', async (_name, reply) => {
    const api = createApi({ url: () => BASE, fetchFn: vi.fn(reply) });
    await expect(api.get()).rejects.toMatchObject({ code: 'network', message: 'Нет связи с сервером' });
  });

  test('адрес бэкенда не задан → ApiError network, запрос не уходит', async () => {
    const fetchFn = vi.fn();
    await expect(createApi({ url: () => '', fetchFn }).get()).rejects.toMatchObject({ code: 'network' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('зависший запрос обрывается через 10 секунд', async () => {
    const fetchFn = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = expect(createApi({ url: () => BASE, fetchFn }).get()).rejects.toMatchObject({ code: 'network' });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
  });
});

describe('resolveBackend (R11)', () => {
  const baked = 'https://baked.example/exec';

  test('без ?backend= — вшитый адрес', () => {
    expect(resolveBackend('', { dev: false, baked })).toBe(baked);
    expect(resolveBackend('?demo=1', { dev: true, baked })).toBe(baked);
  });

  test('в боевой сборке ?backend= работает только для localhost, 127.0.0.1 и [::1]', () => {
    for (const ok of ['http://localhost:8787/exec', 'http://127.0.0.1:8787/exec', 'http://[::1]:8787/exec']) {
      expect(resolveBackend(`?backend=${encodeURIComponent(ok)}`, { dev: false, baked })).toBe(ok);
    }
  });

  test('в боевой сборке чужой хост не подменяет адрес', () => {
    for (const evil of ['https://evil.example/exec', 'http://localhost.evil.example/exec', 'https://127.0.0.1.evil.example/exec']) {
      expect(resolveBackend(`?backend=${encodeURIComponent(evil)}`, { dev: false, baked })).toBe(baked);
    }
  });

  test('в разработке подходит любой http(s)-адрес, но не мусор и не чужая схема', () => {
    const other = 'https://staging.example/exec';
    expect(resolveBackend(`?backend=${encodeURIComponent(other)}`, { dev: true, baked })).toBe(other);
    for (const bad of ['javascript:alert(1)', 'ftp://staging.example/exec', 'не адрес', '']) {
      expect(resolveBackend(`?backend=${encodeURIComponent(bad)}`, { dev: true, baked })).toBe(baked);
    }
  });
});

describe('resolvePollMs (R24)', () => {
  const dev = { dev: true, hostname: 'localhost' };
  const prod = { dev: false, hostname: 'sales.github.io' };

  test('без параметра — умолчание хранилища', () => {
    expect(resolvePollMs('', dev)).toBeUndefined();
    expect(resolvePollMs('?asOf=2026-11-12', dev)).toBeUndefined();
  });

  test('целое от 500 до 15000 принимается в разработке и на локальном хосте', () => {
    expect(resolvePollMs('?pollMs=1000', dev)).toBe(1000);
    expect(resolvePollMs('?pollMs=500', dev)).toBe(500);
    expect(resolvePollMs('?pollMs=15000', dev)).toBe(15000);
    expect(resolvePollMs('?pollMs=1000', { dev: false, hostname: 'localhost' })).toBe(1000);
    expect(resolvePollMs('?pollMs=1000', { dev: false, hostname: '127.0.0.1' })).toBe(1000);
  });

  test('на боевом хосте параметр игнорируется: опрос чаще 15 с нагрузил бы бэкенд', () => {
    expect(resolvePollMs('?pollMs=1000', prod)).toBeUndefined();
  });

  test('вне диапазона и не целое — умолчание, а не обрезка', () => {
    for (const bad of ['499', '15001', '0', '-1000', '1000.5', '1e3', 'abc', '']) {
      expect(resolvePollMs(`?pollMs=${bad}`, dev), bad).toBeUndefined();
    }
  });
});
