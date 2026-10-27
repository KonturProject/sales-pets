import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Snapshot } from './api';
import { createStore } from './store';

const snap = (version: number): Snapshot => ({
  version, serverNow: '2026-11-12T10:00:00+03:00', funnelThrough: null, paymentsImportedThrough: null,
  config: {}, configChanges: [], staff: [], absences: [], payments: [], provisional: [], funnel: [], overrides: [],
});

const unchanged = (serverNow = '2026-11-12T10:00:00+03:00') => ({ unchanged: true as const, version: 1, serverNow });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createStore', () => {
  test('новый снимок доходит до подписчика и current(); следующий опрос просит since=version', async () => {
    const fetchSnapshot = vi.fn().mockResolvedValueOnce(snap(1)).mockResolvedValue(unchanged());
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => true });
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.version));
    expect(store.current()).toBeNull();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([1]);
    expect(store.current()?.version).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchSnapshot).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchSnapshot).toHaveBeenNthCalledWith(2, 1);
    store.stop();
  });

  test('«unchanged» и равная версия подписчика не будят', async () => {
    const fetchSnapshot = vi.fn()
      .mockResolvedValueOnce(snap(1))
      .mockResolvedValueOnce(unchanged())
      .mockResolvedValueOnce(snap(1))
      .mockResolvedValueOnce(snap(2));
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => true });
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.version));
    store.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(4);
    expect(seen).toEqual([1, 2]);
    store.stop();
  });

  test('«без изменений» с новой датой сервера будит подписчиков тем же снимком с новым «сейчас»', async () => {
    const fetchSnapshot = vi.fn()
      .mockResolvedValueOnce(snap(1))
      .mockResolvedValueOnce(unchanged('2026-11-12T23:59:50+03:00'))
      .mockResolvedValueOnce(unchanged('2026-11-13T00:00:05+03:00'))
      .mockResolvedValueOnce(unchanged('2026-11-13T00:00:20+03:00'));
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => true });
    const seen: string[] = [];
    store.subscribe((s) => seen.push(`${s.version} ${s.serverNow}`));
    store.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(4);
    expect(seen).toEqual(['1 2026-11-12T10:00:00+03:00', '1 2026-11-13T00:00:05+03:00']);
    expect(store.current()?.serverNow).toBe('2026-11-13T00:00:05+03:00');
    expect(fetchSnapshot).toHaveBeenLastCalledWith(1);
    store.stop();
  });

  test('скрытая вкладка загружает данные один раз при запуске и дальше не опрашивает', async () => {
    let shown = false;
    const fetchSnapshot = vi.fn().mockResolvedValue(unchanged());
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => shown });
    store.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    shown = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    store.stop();
  });

  test('ошибка сети не роняет подписчиков и сохраняет последний снимок', async () => {
    const fetchSnapshot = vi.fn()
      .mockResolvedValueOnce(snap(1))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(snap(2));
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => true });
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.version));
    store.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([1]);
    expect(store.current()?.version).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([1, 2]);
    store.stop();
  });

  test('подписчик, бросивший исключение, не мешает остальным и опросу', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSnapshot = vi.fn().mockResolvedValueOnce(snap(1)).mockResolvedValueOnce(snap(2));
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => true });
    const seen: number[] = [];
    store.subscribe(() => { throw new Error('render'); });
    store.subscribe((s) => seen.push(s.version));
    store.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([1, 2]);
    expect(error).toHaveBeenCalled();
    store.stop();
    error.mockRestore();
  });

  test('отписка работает', async () => {
    const fetchSnapshot = vi.fn().mockResolvedValueOnce(snap(1)).mockResolvedValueOnce(snap(2));
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => true });
    const seen: number[] = [];
    const off = store.subscribe((s) => seen.push(s.version));
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    off();
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([1]);
    store.stop();
  });

  test('повторный start не плодит таймеры, stop их снимает', async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue(unchanged());
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => true });
    store.start();
    store.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(4); // запуск + три тика
    store.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(4);
  });

  test('refresh читает снимок сразу, без опроса, и будит подписчиков', async () => {
    const fetchSnapshot = vi.fn().mockResolvedValueOnce(snap(1)).mockResolvedValueOnce(snap(2));
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => true });
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.version));
    await store.refresh();
    expect(seen).toEqual([1]);
    await store.refresh();
    expect(fetchSnapshot).toHaveBeenNthCalledWith(2, 1);
    expect(seen).toEqual([1, 2]);
  });

  test('refresh при идущем опросе ждёт его и читает снимок заново: ответ мог выйти до записи', async () => {
    let finish: (v: Snapshot) => void = () => {};
    const fetchSnapshot = vi.fn()
      .mockImplementationOnce(() => new Promise<Snapshot>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(snap(2));
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => true });
    store.start();
    const refreshed = store.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    finish(snap(1));
    await refreshed;
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(store.current()?.version).toBe(2);
    store.stop();
  });

  test('refresh не бросает при обрыве связи: остаётся последний снимок', async () => {
    const fetchSnapshot = vi.fn().mockResolvedValueOnce(snap(1)).mockRejectedValueOnce(new Error('network'));
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => true });
    await store.refresh();
    await expect(store.refresh()).resolves.toBeUndefined();
    expect(store.current()?.version).toBe(1);
  });

  test('новый запрос не начинается, пока предыдущий не вернулся', async () => {
    let finish: (v: ReturnType<typeof unchanged>) => void = () => {};
    const fetchSnapshot = vi.fn(() => new Promise<ReturnType<typeof unchanged>>((resolve) => { finish = resolve; }));
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => true });
    store.start();
    await vi.advanceTimersByTimeAsync(3500);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    finish(unchanged());
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    store.stop();
  });
});
