import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/data/api';
import { createSpender } from './spend';

const refs = () => {
  let n = 0;
  return () => `ref-${++n}`;
};

describe('createSpender', () => {
  test('клик отправляет предмет с новым ref и возвращает true', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const spender = createSpender({ send, newRef: refs() });
    expect(await spender.spend('toy')).toBe(true);
    expect(await spender.spend('toy')).toBe(true);
    expect(send.mock.calls).toEqual([['toy', 'ref-1'], ['toy', 'ref-2']]);
  });

  test('пока запрос идёт, новый клик игнорируется и ничего не отправляет', async () => {
    let finish: () => void = () => {};
    const send = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockResolvedValue({ ok: true });
    const spender = createSpender({ send, newRef: refs() });
    const first = spender.spend('medkit');
    expect(spender.busy).toBe(true);
    expect(await spender.spend('toy')).toBe(false);
    expect(await spender.spend('medkit')).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    finish();
    expect(await first).toBe(true);
    expect(spender.busy).toBe(false);
    expect(await spender.spend('toy')).toBe(true);
  });

  test('после обрыва связи тот же предмет уходит с тем же ref: сервер узнает повтор и не спишет дважды', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new ApiError('network', 'Нет связи'))
      .mockResolvedValue({ ok: true });
    const spender = createSpender({ send, newRef: refs() });
    await expect(spender.spend('toy')).rejects.toMatchObject({ code: 'network' });
    expect(spender.busy).toBe(false);
    expect(await spender.spend('toy')).toBe(true);
    expect(send.mock.calls).toEqual([['toy', 'ref-1'], ['toy', 'ref-1']]);
    expect(await spender.spend('toy')).toBe(true);
    expect(send.mock.calls[2]).toEqual(['toy', 'ref-2']);
  });

  test('обрыв связи на игрушке не навязывает ref аптечке', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new ApiError('network', 'Нет связи'))
      .mockResolvedValue({ ok: true });
    const spender = createSpender({ send, newRef: refs() });
    await expect(spender.spend('toy')).rejects.toBeInstanceOf(ApiError);
    await spender.spend('medkit');
    await spender.spend('toy');
    expect(send.mock.calls).toEqual([['toy', 'ref-1'], ['medkit', 'ref-2'], ['toy', 'ref-1']]);
  });

  test('ответ сервера, пусть и отказ, закрывает попытку: следующий клик получает новый ref', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new ApiError('bad_request', 'bad_request'))
      .mockResolvedValue({ ok: true });
    const spender = createSpender({ send, newRef: refs() });
    await expect(spender.spend('toy')).rejects.toMatchObject({ code: 'bad_request' });
    await spender.spend('toy');
    expect(send.mock.calls).toEqual([['toy', 'ref-1'], ['toy', 'ref-2']]);
  });
});
