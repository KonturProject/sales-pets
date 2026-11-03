import { describe, expect, test, vi, type Mock } from 'vitest';
import { ApiError } from '@/data/api';
import type { CorrectionItem } from './results';
import { BUSY_TEXT, WriteRefused, createResultsFlow } from './resultsFlow';

const item = (delta: number): CorrectionItem => ({ date: '2026-11-03', employeeId: 'a1', kind: 'long', delta, base: 2 });
const refs = () => {
  let n = 0;
  return () => `ref-${++n}`;
};
/** Обещание, которое завершается вручную. */
const hold = <T = void>() => {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

type Over = Partial<Record<'send' | 'remove' | 'load' | 'apply' | 'setBusy', Mock>>;

function setup(over: Over = {}) {
  let version = 0;
  const mocks = {
    send: over.send ?? vi.fn().mockResolvedValue({ ok: true }),
    remove: over.remove ?? vi.fn().mockResolvedValue({ ok: true }),
    load: over.load ?? vi.fn(async () => ++version),
    apply: over.apply ?? vi.fn(),
    setBusy: over.setBusy ?? vi.fn(),
  };
  return { flow: createResultsFlow<number>({ ...mocks, newRef: refs() }), ...mocks };
}

describe('createResultsFlow: запись и перечитывание', () => {
  test('правка: один запрос, свежий снимок применён, вкладка занята только на время записи', async () => {
    const { flow, send, load, apply, setBusy } = setup();
    expect(await flow.correct([item(1)])).toEqual({ result: 'saved', refreshError: null });
    expect(send.mock.calls).toEqual([[[item(1)], 'ref-1']]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(1);
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(flow.busy).toBe(false);
  });

  test('отмена: removeCorrection и перечитывание', async () => {
    const { flow, remove, apply, setBusy } = setup();
    expect(await flow.remove(5)).toEqual({ refreshError: null });
    expect(remove).toHaveBeenCalledWith(5);
    expect(apply).toHaveBeenCalledWith(1);
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
  });

  test('ошибка записи: пробрасывается, вкладка разблокирована, снимок не перечитывается', async () => {
    const { flow, load, apply, setBusy } = setup({ send: vi.fn().mockRejectedValue(new ApiError('network', 'Нет связи')) });
    await expect(flow.correct([item(1)])).rejects.toMatchObject({ code: 'network' });
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(load).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(flow.busy).toBe(false);
  });

  test('ошибка отмены: пробрасывается, вкладка разблокирована', async () => {
    const { flow, setBusy, apply } = setup({ remove: vi.fn().mockRejectedValue(new ApiError('server_error', 'server_error')) });
    await expect(flow.remove(5)).rejects.toMatchObject({ code: 'server_error' });
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(apply).not.toHaveBeenCalled();
  });

  test('запись прошла, а снимок прочитать не удалось: это не провал записи', async () => {
    const boom = new ApiError('network', 'Нет связи');
    const { flow, apply } = setup({ load: vi.fn().mockRejectedValue(boom) });
    expect(await flow.correct([item(1)])).toEqual({ result: 'saved', refreshError: boom });
    expect(apply).not.toHaveBeenCalled();
    expect(flow.busy).toBe(false);
  });
});

describe('createResultsFlow: одна запись за раз', () => {
  test('пока правка пишется, вторая правка отклоняется с понятным текстом и ничего не отправляет', async () => {
    const gate = hold<unknown>();
    const { flow, send, setBusy } = setup({ send: vi.fn().mockReturnValue(gate.promise) });
    const first = flow.correct([item(1)]);
    expect(flow.busy).toBe(true);
    const second = flow.correct([item(2)]);
    await expect(second).rejects.toBeInstanceOf(WriteRefused);
    await expect(second).rejects.toThrow(BUSY_TEXT);
    expect(send).toHaveBeenCalledTimes(1);
    expect(setBusy.mock.calls).toEqual([[true]]); // отклонённый вызов вкладку не трогает
    gate.resolve({ ok: true });
    await first;
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
  });

  test('отмена и правка исключают друг друга в обе стороны', async () => {
    const gate = hold<unknown>();
    const { flow, send, remove } = setup({ remove: vi.fn().mockReturnValue(gate.promise) });
    const removing = flow.remove(5);
    await expect(flow.correct([item(1)])).rejects.toBeInstanceOf(WriteRefused);
    expect(send).not.toHaveBeenCalled();
    gate.resolve({ ok: true });
    await removing;

    const gate2 = hold<unknown>();
    const second = setup({ send: vi.fn().mockReturnValue(gate2.promise) });
    const saving = second.flow.correct([item(1)]);
    await expect(second.flow.remove(5)).rejects.toBeInstanceOf(WriteRefused);
    expect(second.remove).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
    gate2.resolve({ ok: true });
    await saving;
  });
});

describe('createResultsFlow: обрыв связи', () => {
  const lost = () => vi.fn().mockRejectedValueOnce(new ApiError('network', 'Нет связи')).mockResolvedValue({ ok: true });

  test('те же значения после обрыва уходят с тем же ref', async () => {
    const { flow, send } = setup({ send: lost() });
    await expect(flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    expect(await flow.correct([item(7)])).toMatchObject({ result: 'saved' });
    expect(send.mock.calls.map((c) => c[1])).toEqual(['ref-1', 'ref-1']);
  });

  test('другие значения после обрыва (+7 потерян, теперь 8): запрос не уходит, данные перечитываются', async () => {
    const { flow, send, load, apply } = setup({ send: lost() });
    await expect(flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    expect(load).not.toHaveBeenCalled();
    expect(await flow.correct([item(8)])).toEqual({ result: 'changed', refreshError: null });
    expect(send).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    // дальше обычная запись: значение посчитано уже от перечитанных данных, ref новый
    expect(await flow.correct([item(1)])).toMatchObject({ result: 'saved' });
    expect(send.mock.calls.map((c) => c[1])).toEqual(['ref-1', 'ref-2']);
  });

  test('после отмены правки ожидание ответа забыто: та же правка, введённая заново, уходит с новым ref', async () => {
    const { flow, send } = setup({ send: lost() });
    await expect(flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    await flow.remove(5);
    expect(await flow.correct([item(7)])).toMatchObject({ result: 'saved' });
    expect(send.mock.calls.map((c) => c[1])).toEqual(['ref-1', 'ref-2']);
  });

  test('«changed» и сбой чтения снимка: результат сохранён, ошибка чтения отдельно', async () => {
    const boom = new ApiError('network', 'Нет связи');
    const { flow } = setup({ send: lost(), load: vi.fn().mockRejectedValue(boom) });
    await expect(flow.correct([item(7)])).rejects.toBeInstanceOf(ApiError);
    expect(await flow.correct([item(8)])).toEqual({ result: 'changed', refreshError: boom });
  });
});

describe('createResultsFlow: порядок снимков', () => {
  test('старый снимок не рисуется поверх нового, даже если пришёл позже', async () => {
    const slow = hold<number>();
    const loads = [slow.promise, Promise.resolve(2)];
    const { flow, apply } = setup({ load: vi.fn(() => loads.shift()!) });
    const older = flow.refresh();
    const newer = flow.refresh();
    await newer;
    slow.resolve(1);
    await older;
    expect(apply.mock.calls).toEqual([[2]]);
  });
});
