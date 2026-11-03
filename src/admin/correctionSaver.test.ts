import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/data/api';
import { createCorrectionSaver, randomRef, type PendingHolder } from './correctionSaver';
import type { CorrectionItem } from './results';

const item = (delta: number): CorrectionItem => ({ date: '2026-11-03', employeeId: 'a1', kind: 'long', delta, base: 2 });
const refs = () => {
  let n = 0;
  return () => `ref-${++n}`;
};
const network = () => new ApiError('network', 'Нет связи');

describe('createCorrectionSaver', () => {
  test('каждая запись уходит одним запросом с новым ref', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const saver = createCorrectionSaver({ send, newRef: refs() });
    expect(await saver.save([item(1)])).toBe('saved');
    expect(await saver.save([item(1)])).toBe('saved');
    expect(send.mock.calls).toEqual([[[item(1)], 'ref-1'], [[item(1)], 'ref-2']]);
  });

  test('пока запись идёт, второй вызов ничего не отправляет и отвечает «занято»', async () => {
    let finish: () => void = () => {};
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue({ ok: true });
    const saver = createCorrectionSaver({ send, newRef: refs() });
    const first = saver.save([item(1)]);
    expect(saver.busy).toBe(true);
    expect(await saver.save([item(1)])).toBe('busy');
    expect(send).toHaveBeenCalledTimes(1);
    finish();
    expect(await first).toBe('saved');
    expect(saver.busy).toBe(false);
  });

  test('после обрыва связи те же правки уходят с тем же ref: сервер узнает повтор', async () => {
    const send = vi.fn().mockRejectedValueOnce(network()).mockResolvedValue({ ok: true });
    const saver = createCorrectionSaver({ send, newRef: refs() });
    await expect(saver.save([item(1)])).rejects.toMatchObject({ code: 'network' });
    expect(saver.busy).toBe(false);
    expect(saver.hasPending).toBe(true);
    expect(await saver.save([item(1)])).toBe('saved');
    expect(saver.hasPending).toBe(false);
    expect(send.mock.calls.map((c) => c[1])).toEqual(['ref-1', 'ref-1']);
    await saver.save([item(1)]);
    expect(send.mock.calls[2][1]).toBe('ref-2');
  });

  test('после обрыва другие правки не отправляются: уходит повтор прошлого запроса слово в слово, ответ — «changed»', async () => {
    const send = vi.fn().mockRejectedValueOnce(network()).mockResolvedValue({ ok: true });
    const saver = createCorrectionSaver({ send, newRef: refs() });
    await expect(saver.save([item(7)])).rejects.toBeInstanceOf(ApiError);
    expect(saver.differs([item(8)])).toBe(true);
    expect(saver.differs([item(7)])).toBe(false);
    expect(await saver.save([item(8)])).toBe('changed');
    // только повтор того же запроса: правки +7 и ref-1; «8» на сервер не ушло
    expect(send.mock.calls).toEqual([[[item(7)], 'ref-1'], [[item(7)], 'ref-1']]);
    // ответ получен — ожидание снято, следующая запись обычная
    expect(saver.hasPending).toBe(false);
    expect(await saver.save([item(8)])).toBe('saved');
    expect(send.mock.calls[2]).toEqual([[item(8)], 'ref-2']);
  });

  test('повтор прошлого запроса тоже без ответа: ожидание остаётся, ошибка пробрасывается, новые правки не уходят', async () => {
    const send = vi.fn().mockRejectedValueOnce(network()).mockRejectedValueOnce(network()).mockResolvedValue({ ok: true });
    const saver = createCorrectionSaver({ send, newRef: refs() });
    await expect(saver.save([item(7)])).rejects.toBeInstanceOf(ApiError);
    await expect(saver.save([item(8)])).rejects.toMatchObject({ code: 'network' });
    expect(saver.hasPending).toBe(true);
    expect(saver.busy).toBe(false);
    expect(send.mock.calls.map((c) => [c[0], c[1]])).toEqual([[[item(7)], 'ref-1'], [[item(7)], 'ref-1']]);
    expect(await saver.save([item(8)])).toBe('changed'); // следующий повтор дошёл
    expect(send).toHaveBeenCalledTimes(3);
  });

  test('отказ сервера на повтор — тоже ответ: ожидание снято', async () => {
    const send = vi.fn().mockRejectedValueOnce(network()).mockRejectedValueOnce(new ApiError('bad_request', 'bad_request')).mockResolvedValue({ ok: true });
    const saver = createCorrectionSaver({ send, newRef: refs() });
    await expect(saver.save([item(7)])).rejects.toBeInstanceOf(ApiError);
    expect(await saver.save([item(8)])).toBe('changed');
    expect(saver.hasPending).toBe(false);
  });

  test('неверный PIN или блокировка на повторе — не ответ о записи: ожидание остаётся', async () => {
    const send = vi.fn().mockRejectedValueOnce(network()).mockRejectedValueOnce(new ApiError('locked', 'locked', 60));
    const saver = createCorrectionSaver({ send, newRef: refs() });
    await expect(saver.save([item(7)])).rejects.toBeInstanceOf(ApiError);
    await expect(saver.save([item(8)])).rejects.toMatchObject({ code: 'locked' });
    expect(saver.hasPending).toBe(true);
  });

  test('ошибка сервера без ответа о записи тоже повторяется с тем же ref, а отказ сервера — нет', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new ApiError('server_error', 'server_error'))
      .mockRejectedValueOnce(new ApiError('bad_request', 'bad_request'))
      .mockResolvedValue({ ok: true });
    const saver = createCorrectionSaver({ send, newRef: refs() });
    await expect(saver.save([item(1)])).rejects.toBeInstanceOf(ApiError);
    await expect(saver.save([item(1)])).rejects.toBeInstanceOf(ApiError);
    // отказ записи не было: другие правки после него уходят без оговорок
    expect(await saver.save([item(2)])).toBe('saved');
    expect(send.mock.calls.map((c) => c[1])).toEqual(['ref-1', 'ref-1', 'ref-2']);
  });

  test('отказ сервера на первую отправку не оставляет ожидания', async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError('bad_request', 'bad_request')).mockResolvedValue({ ok: true });
    const saver = createCorrectionSaver({ send, newRef: refs() });
    await expect(saver.save([item(1)])).rejects.toBeInstanceOf(ApiError);
    expect(saver.hasPending).toBe(false);
  });

  test('resolve(): без ожидания ничего не шлёт, с ожиданием повторяет запрос слово в слово', async () => {
    const send = vi.fn().mockRejectedValueOnce(network()).mockResolvedValue({ ok: true });
    const saver = createCorrectionSaver({ send, newRef: refs() });
    expect(await saver.resolve()).toBe(false);
    expect(send).not.toHaveBeenCalled();
    await expect(saver.save([item(7)])).rejects.toBeInstanceOf(ApiError);
    expect(await saver.resolve()).toBe(true);
    expect(send.mock.calls).toEqual([[[item(7)], 'ref-1'], [[item(7)], 'ref-1']]);
    expect(saver.hasPending).toBe(false);
    expect(await saver.resolve()).toBe(false);
  });

  test('resolve(): повтор без ответа — ошибка пробрасывается, ожидание остаётся', async () => {
    const send = vi.fn().mockRejectedValue(network());
    const saver = createCorrectionSaver({ send, newRef: refs() });
    await expect(saver.save([item(7)])).rejects.toBeInstanceOf(ApiError);
    await expect(saver.resolve()).rejects.toMatchObject({ code: 'network' });
    expect(saver.hasPending).toBe(true);
  });

  test('ожидание лежит вне экземпляра: другой экземпляр (новая вкладка) видит его и повторяет слово в слово', async () => {
    const pending: PendingHolder = { current: null };
    const lost = vi.fn().mockRejectedValue(network());
    await expect(createCorrectionSaver({ send: lost, newRef: refs(), pending }).save([item(7)])).rejects.toBeInstanceOf(ApiError);
    const send = vi.fn().mockResolvedValue({ ok: true });
    const next = createCorrectionSaver({ send, newRef: refs(), pending });
    expect(next.hasPending).toBe(true);
    expect(await next.save([item(8)])).toBe('changed');
    expect(send.mock.calls).toEqual([[[item(7)], 'ref-1']]);
    expect(pending.current).toBeNull();
  });
});

describe('createCorrectionSaver: ушедший с экрана экземпляр', () => {
  /** Обещание, которое завершается вручную. */
  const hold = () => {
    let resolve: (v: unknown) => void = () => {};
    let reject: (e: unknown) => void = () => {};
    const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
  /** Держатель с запросом p, который повторяет «старый» экземпляр; пока его ответ в пути, держатель получает новый запрос. */
  async function lateAnswer(settle: (gate: ReturnType<typeof hold>) => void, act: (saver: ReturnType<typeof createCorrectionSaver>) => Promise<unknown>) {
    const pending: PendingHolder = { current: null };
    const lostSend = vi.fn().mockRejectedValue(network());
    await expect(createCorrectionSaver({ send: lostSend, newRef: refs(), pending }).save([item(7)])).rejects.toBeInstanceOf(ApiError);
    const gate = hold();
    const old = createCorrectionSaver({ send: vi.fn(() => gate.promise), newRef: refs(), pending });
    const running = act(old);
    const newer = { items: [item(9)], ref: 'ref-9' };
    pending.current = newer; // за это время другой экземпляр потерял свою запись
    settle(gate);
    await running.catch(() => {});
    return { pending, newer };
  }

  test('запоздалый ответ на повтор не стирает более новое ожидание', async () => {
    const { pending, newer } = await lateAnswer((g) => g.resolve({ ok: true }), (saver) => saver.resolve());
    expect(pending.current).toBe(newer);
  });

  test('запоздалый отказ сервера на повтор тоже не стирает более новое ожидание', async () => {
    const { pending, newer } = await lateAnswer((g) => g.reject(new ApiError('bad_request', 'bad_request')), (saver) => saver.resolve());
    expect(pending.current).toBe(newer);
  });

  test('так же для повтора тех же правок через save()', async () => {
    const ok = await lateAnswer((g) => g.resolve({ ok: true }), (saver) => saver.save([item(7)]));
    expect(ok.pending.current).toBe(ok.newer);
    const refused = await lateAnswer((g) => g.reject(new ApiError('bad_request', 'bad_request')), (saver) => saver.save([item(7)]));
    expect(refused.pending.current).toBe(refused.newer);
  });

  test('повтор получил ответ, а ожидание то же самое — оно снимается', async () => {
    const pending: PendingHolder = { current: null };
    const send = vi.fn().mockRejectedValueOnce(network()).mockResolvedValue({ ok: true });
    const saver = createCorrectionSaver({ send, newRef: refs(), pending });
    await expect(saver.save([item(7)])).rejects.toBeInstanceOf(ApiError);
    await saver.resolve();
    expect(pending.current).toBeNull();
  });
});

describe('randomRef', () => {
  test('не длиннее 64 символов и каждый раз новый', () => {
    const a = randomRef();
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(randomRef()).not.toBe(a);
  });

  test('без crypto.randomUUID — hex из случайных байтов', () => {
    try {
      vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(171) });
      expect(randomRef()).toBe('ab'.repeat(16));
      vi.stubGlobal('crypto', undefined);
      expect(randomRef()).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
