import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/data/api';
import { createCorrectionSaver, randomRef } from './correctionSaver';
import type { CorrectionItem } from './results';

const item = (delta: number): CorrectionItem => ({ date: '2026-11-03', employeeId: 'a1', kind: 'long', delta, base: 2 });
const refs = () => {
  let n = 0;
  return () => `ref-${++n}`;
};

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
    const send = vi.fn().mockRejectedValueOnce(new ApiError('network', 'Нет связи')).mockResolvedValue({ ok: true });
    const saver = createCorrectionSaver({ send, newRef: refs() });
    await expect(saver.save([item(1)])).rejects.toMatchObject({ code: 'network' });
    expect(saver.busy).toBe(false);
    expect(await saver.save([item(1)])).toBe('saved');
    expect(send.mock.calls.map((c) => c[1])).toEqual(['ref-1', 'ref-1']);
    await saver.save([item(1)]);
    expect(send.mock.calls[2][1]).toBe('ref-2');
  });

  test('после обрыва другие правки не отправляются: первая запись могла дойти, а разница посчитана от старых данных', async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError('network', 'Нет связи')).mockResolvedValue({ ok: true });
    const saver = createCorrectionSaver({ send, newRef: refs() });
    await expect(saver.save([item(7)])).rejects.toBeInstanceOf(ApiError);
    expect(await saver.save([item(8)])).toBe('changed');
    expect(send).toHaveBeenCalledTimes(1);
    // после «changed» ожидание ответа снято: следующая запись обычная, с новым ref
    expect(await saver.save([item(8)])).toBe('saved');
    expect(send.mock.calls.map((c) => c[1])).toEqual(['ref-1', 'ref-2']);
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
