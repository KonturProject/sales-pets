import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/data/api';
import { createSession } from './session';

const secret = '987654';

function setup(reply: (action: string, body: Record<string, unknown>) => unknown = () => ({ ok: true })) {
  const calls: { action: string; body: Record<string, unknown> }[] = [];
  const post = vi.fn(async (action: string, body: object) => {
    calls.push({ action, body: body as Record<string, unknown> });
    const r = reply(action, body as Record<string, unknown>);
    if (r instanceof Error) throw r;
    return r;
  });
  const onLogout = vi.fn();
  return { session: createSession(post as never, onLogout), calls, onLogout };
}

describe('createSession', () => {
  it('login проверяет PIN действием login и дальше подставляет его в каждый вызов', async () => {
    const { session, calls } = setup();
    await session.login(secret);
    await session.call('setProvisional', { group: 'СР1', count: 3 });
    expect(calls[0]).toEqual({ action: 'login', body: { pin: secret } });
    expect(calls[1]).toEqual({ action: 'setProvisional', body: { group: 'СР1', count: 3, pin: secret } });
  });

  it('PIN из тела вызова не подменяет PIN сессии', async () => {
    const { session, calls } = setup();
    await session.login(secret);
    await session.call('setStaff', { pin: 'чужой' });
    expect(calls[1].body.pin).toBe(secret);
  });

  it('неверный PIN при входе бросает ошибку и не запоминается', async () => {
    const { session, onLogout } = setup(() => new ApiError('invalid_pin', 'invalid_pin'));
    await expect(session.login('0000')).rejects.toMatchObject({ code: 'invalid_pin' });
    await expect(session.call('setStaff')).rejects.toMatchObject({ code: 'invalid_pin' });
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('вызов до входа не уходит на сервер', async () => {
    const { session, calls } = setup();
    await expect(session.call('setStaff')).rejects.toMatchObject({ code: 'invalid_pin' });
    expect(calls).toHaveLength(0);
  });

  it.each(['invalid_pin', 'locked'] as const)('%s посреди работы забывает PIN и зовёт onLogout один раз', async (code) => {
    let fail = false;
    const { session, calls, onLogout } = setup(() => (fail ? new ApiError(code, code) : { ok: true }));
    await session.login(secret);
    fail = true;
    await expect(session.call('setStaff')).rejects.toMatchObject({ code });
    await expect(session.call('setStaff')).rejects.toMatchObject({ code: 'invalid_pin' });
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.action === 'setStaff')).toHaveLength(1);
  });

  it('сбой сети и ошибка запроса сессию не закрывают', async () => {
    let error: ApiError | null = null;
    const { session, onLogout } = setup(() => error ?? { ok: true });
    await session.login(secret);
    error = new ApiError('network', 'x');
    await expect(session.call('setStaff')).rejects.toMatchObject({ code: 'network' });
    error = new ApiError('bad_request', 'x');
    await expect(session.call('setStaff')).rejects.toMatchObject({ code: 'bad_request' });
    error = null;
    await expect(session.call('setStaff')).resolves.toEqual({ ok: true });
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('logout забывает PIN без вызова onLogout', async () => {
    const { session, onLogout } = setup();
    await session.login(secret);
    session.logout();
    await expect(session.call('setStaff')).rejects.toMatchObject({ code: 'invalid_pin' });
    expect(onLogout).not.toHaveBeenCalled();
  });
});
