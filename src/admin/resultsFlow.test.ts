import { describe, expect, test, vi, type Mock } from 'vitest';
import { ApiError } from '@/data/api';
import type { PendingHolder } from './correctionSaver';
import type { CorrectionItem } from './results';
import { BUSY_TEXT, STALE_TEXT, WriteRefused, createResultsFlow } from './resultsFlow';

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

type Over = Partial<Record<'send' | 'remove' | 'load' | 'apply' | 'setBusy' | 'setStale', Mock>>;

function setup(over: Over = {}, pending?: PendingHolder) {
  let version = 0;
  const mocks = {
    send: over.send ?? vi.fn().mockResolvedValue({ ok: true }),
    remove: over.remove ?? vi.fn().mockResolvedValue({ ok: true }),
    load: over.load ?? vi.fn(async () => ++version),
    apply: over.apply ?? vi.fn(),
    setBusy: over.setBusy ?? vi.fn(),
    setStale: over.setStale ?? vi.fn(),
  };
  return { flow: createResultsFlow<number>({ ...mocks, newRef: refs(), pending }), ...mocks };
}

describe('createResultsFlow: запись и перечитывание', () => {
  test('правка: один запрос, свежий снимок применён, вкладка занята только на время записи', async () => {
    const { flow, send, load, apply, setBusy, setStale } = setup();
    expect(await flow.correct([item(1)])).toEqual({ result: 'saved', refreshError: null });
    expect(setStale).not.toHaveBeenCalled();
    expect(send.mock.calls).toEqual([[[item(1)], 'ref-1']]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(1);
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(flow.busy).toBe(false);
  });

  test('отмена: removeCorrection и перечитывание', async () => {
    const { flow, remove, apply, setBusy } = setup();
    expect(await flow.remove(5)).toEqual({ removed: true, refreshError: null });
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

  test('ошибка отмены: пробрасывается, вкладка разблокирована, а результат неизвестен — снимок перечитан', async () => {
    const { flow, setBusy, apply } = setup({ remove: vi.fn().mockRejectedValue(new ApiError('server_error', 'server_error')) });
    await expect(flow.remove(5)).rejects.toMatchObject({ code: 'server_error' });
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(apply).toHaveBeenCalledWith(1);
  });

  test('запись прошла, а снимок прочитать не удалось: это не провал записи', async () => {
    const boom = new ApiError('network', 'Нет связи');
    const { flow, apply, setStale } = setup({ load: vi.fn().mockRejectedValue(boom) });
    expect(await flow.correct([item(1)])).toEqual({ result: 'saved', refreshError: boom });
    expect(apply).not.toHaveBeenCalled();
    expect(setStale.mock.calls).toEqual([[true]]); // таблица теперь не показывает записанное
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

  test('другие значения после обрыва (+7 потерян, теперь 8): уходит повтор прошлого запроса, а не «8»; потом данные перечитываются', async () => {
    const { flow, send, load, apply } = setup({ send: lost() });
    await expect(flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    expect(load).not.toHaveBeenCalled();
    expect(await flow.correct([item(8)])).toEqual({ result: 'changed', refreshError: null });
    expect(send.mock.calls).toEqual([[[item(7)], 'ref-1'], [[item(7)], 'ref-1']]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    // дальше обычная запись: значение посчитано уже от перечитанных данных, ref новый
    expect(await flow.correct([item(1)])).toMatchObject({ result: 'saved' });
    expect(send.mock.calls.map((c) => c[1])).toEqual(['ref-1', 'ref-1', 'ref-2']);
  });

  test('«Отменить» при неотвеченной записи ничего не удаляет: сначала повтор и перечитывание, отмена — следующим нажатием', async () => {
    const { flow, send, remove, load } = setup({ send: lost() });
    await expect(flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    expect(await flow.remove(5)).toEqual({ removed: false, refreshError: null });
    expect(remove).not.toHaveBeenCalled();
    expect(send.mock.calls).toEqual([[[item(7)], 'ref-1'], [[item(7)], 'ref-1']]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await flow.remove(5)).toEqual({ removed: true, refreshError: null }); // ожидания нет — обычная отмена
    expect(remove).toHaveBeenCalledWith(5);
  });

  test('«Отменить» при неотвеченной записи, а повтор без ответа: ничего не удаляется, вкладка устарела, ошибка пробрасывается', async () => {
    const down = vi.fn().mockRejectedValue(new ApiError('network', 'Нет связи'));
    const { flow, remove, setStale } = setup({ send: down });
    await expect(flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    await expect(flow.remove(5)).rejects.toMatchObject({ code: 'network' });
    expect(remove).not.toHaveBeenCalled();
    expect(setStale.mock.calls).toEqual([[true]]);
    await expect(flow.remove(5)).rejects.toThrow(STALE_TEXT);
  });

  test('«changed» и сбой чтения снимка: результат сохранён, ошибка чтения отдельно', async () => {
    const boom = new ApiError('network', 'Нет связи');
    const { flow } = setup({ send: lost(), load: vi.fn().mockRejectedValue(boom) });
    await expect(flow.correct([item(7)])).rejects.toBeInstanceOf(ApiError);
    expect(await flow.correct([item(8)])).toEqual({ result: 'changed', refreshError: boom });
  });
});

/** Чтение снимка, которое можно ломать и чинить по ходу теста. */
const flaky = (state: { fail: boolean }) => vi.fn(async () => {
  if (state.fail) throw new ApiError('network', 'Нет связи');
  return 2;
});

describe('createResultsFlow: пока снимок после записи не прочитан, писать нельзя', () => {
  const lostFirst = () => vi.fn().mockRejectedValueOnce(new ApiError('network', 'Нет связи')).mockResolvedValue({ ok: true });

  test('запись прошла, снимок не прочитан: правка и отмена ничего не отправляют, пока не нажали «Обновить»', async () => {
    const state = { fail: true };
    const { flow, send, remove, apply, setStale } = setup({ load: flaky(state) });
    expect(await flow.correct([item(1)])).toMatchObject({ result: 'saved', refreshError: expect.any(ApiError) });
    expect(setStale.mock.calls).toEqual([[true]]);
    await expect(flow.correct([item(1)])).rejects.toThrow(STALE_TEXT); // повтор того же ввода задвоил бы правку
    await expect(flow.correct([item(2)])).rejects.toBeInstanceOf(WriteRefused);
    await expect(flow.remove(5)).rejects.toThrow(STALE_TEXT);
    expect(send).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    // «Обновить» не удалось — по-прежнему закрыто
    expect((await flow.reload()).error).toBeInstanceOf(ApiError);
    await expect(flow.correct([item(1)])).rejects.toThrow(STALE_TEXT);
    expect(setStale.mock.calls).toEqual([[true]]);
    state.fail = false;
    expect(await flow.reload()).toEqual({ checked: false, error: null });
    expect(apply).toHaveBeenCalledWith(2);
    expect(setStale.mock.calls).toEqual([[true], [false]]);
    expect(await flow.correct([item(1)])).toMatchObject({ result: 'saved' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('потерян ответ, затем другое значение, а перечитать не удалось: дальше не уходит ничего, даже прежнее значение', async () => {
    const state = { fail: true };
    const { flow, send, setStale } = setup({ send: lostFirst(), load: flaky(state) });
    await expect(flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    expect(setStale).not.toHaveBeenCalled(); // потерянный ответ сам по себе берёт под охрану только прежний ввод
    expect(await flow.correct([item(8)])).toMatchObject({ result: 'changed', refreshError: expect.any(ApiError) });
    expect(setStale.mock.calls).toEqual([[true]]);
    await expect(flow.correct([item(8)])).rejects.toThrow(STALE_TEXT); // иначе уйдёт +8 от устаревшего значения
    await expect(flow.correct([item(7)])).rejects.toThrow(STALE_TEXT);
    expect(send).toHaveBeenCalledTimes(2); // потерянный запрос и его повтор; «8» не уходило
    state.fail = false;
    expect(await flow.reload()).toEqual({ checked: false, error: null });
    expect(await flow.correct([item(8)])).toMatchObject({ result: 'saved' });
    expect(send.mock.calls.map((c) => c[1])).toEqual(['ref-1', 'ref-1', 'ref-2']);
  });

  test('отмена прошла, снимок не прочитан: ничего не уходит, пока не нажали «Обновить»', async () => {
    const state = { fail: true };
    const { flow, send, remove } = setup({ load: flaky(state) });
    expect(await flow.remove(5)).toMatchObject({ removed: true, refreshError: expect.any(ApiError) });
    await expect(flow.correct([item(7)])).rejects.toThrow(STALE_TEXT);
    await expect(flow.correct([item(8)])).rejects.toThrow(STALE_TEXT);
    await expect(flow.remove(6)).rejects.toThrow(STALE_TEXT);
    expect(send).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
    state.fail = false;
    expect(await flow.reload()).toEqual({ checked: false, error: null });
    expect(await flow.correct([item(8)])).toMatchObject({ result: 'saved' });
  });

  test('потерянная запись, «Отменить», а перечитать не удалось: повтор был, ничего не удалено, вкладка закрыта', async () => {
    const state = { fail: false };
    const { flow, send, remove } = setup({ send: lostFirst(), load: flaky(state) });
    await expect(flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    state.fail = true;
    expect(await flow.remove(5)).toMatchObject({ removed: false, refreshError: expect.any(ApiError) });
    expect(remove).not.toHaveBeenCalled();
    await expect(flow.correct([item(8)])).rejects.toThrow(STALE_TEXT);
    await expect(flow.remove(6)).rejects.toThrow(STALE_TEXT);
    expect(send.mock.calls).toEqual([[[item(7)], 'ref-1'], [[item(7)], 'ref-1']]); // повтор слово в слово, «8» не уходило
    state.fail = false;
    expect(await flow.reload()).toEqual({ checked: false, error: null }); // повтор уже получил ответ
    expect(await flow.correct([item(8)])).toMatchObject({ result: 'saved' });
    expect(send.mock.calls.map((c) => c[1])).toEqual(['ref-1', 'ref-1', 'ref-2']);
  });

  test('отмена без ответа: данные перечитываются, а не вышло — вкладка «устарела»', async () => {
    const network = () => new ApiError('network', 'Нет связи');
    const ok = setup({ remove: vi.fn().mockRejectedValue(network()) });
    await expect(ok.flow.remove(5)).rejects.toMatchObject({ code: 'network' });
    expect(ok.load).toHaveBeenCalledTimes(1);
    expect(ok.setStale).not.toHaveBeenCalled();
    expect(await ok.flow.correct([item(1)])).toMatchObject({ result: 'saved' });

    const down = setup({ remove: vi.fn().mockRejectedValue(network()), load: vi.fn().mockRejectedValue(network()) });
    await expect(down.flow.remove(5)).rejects.toMatchObject({ code: 'network' });
    expect(down.setStale.mock.calls).toEqual([[true]]);
    await expect(down.flow.correct([item(1)])).rejects.toThrow(STALE_TEXT);
    expect(down.send).not.toHaveBeenCalled();
  });

  test('отказ сервера (запись не сделана) вкладку не «устаревает» и снимок не перечитывает', async () => {
    const { flow, load, setStale } = setup({ remove: vi.fn().mockRejectedValue(new ApiError('bad_request', 'bad_request')) });
    await expect(flow.remove(5)).rejects.toMatchObject({ code: 'bad_request' });
    expect(load).not.toHaveBeenCalled();
    expect(setStale).not.toHaveBeenCalled();
  });

  test('«Обновить» занимает замок вкладки: пока идёт запись, отклоняется', async () => {
    const gate = hold<unknown>();
    const { flow, load } = setup({ send: vi.fn().mockReturnValue(gate.promise) });
    const saving = flow.correct([item(1)]);
    await expect(flow.reload()).rejects.toThrow(BUSY_TEXT);
    expect(load).not.toHaveBeenCalled();
    gate.resolve({ ok: true });
    await saving;
  });

  test('«Обновить» без «устаревания»: просто читает и рисует под замком вкладки', async () => {
    const { flow, setBusy, setStale, apply } = setup();
    expect(await flow.reload()).toEqual({ checked: false, error: null });
    expect(apply).toHaveBeenCalledWith(1);
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(setStale).not.toHaveBeenCalled();
  });
});

/**
 * Сервер, как Apps Script: запись идёт под замком, повтор с тем же `ref` ничего не пишет (пока строки с ним есть), строки
 * удаляются по номеру, а чтение (doGet) замка не берёт и недописанного не видит. Первый запрос клиент «не дождался»
 * (таймаут 30 с, холодный старт до 35 с): либо сервер его ещё пишет и допишет, когда до замка дойдёт следующий запрос
 * (`lateFirst`), либо запись дошла, а ответ потерян (`landedFirst`).
 */
function fakeServer() {
  let rows: Array<{ id: number; ref: string; delta: number }> = [];
  let nextId = 1;
  let writing: { items: CorrectionItem[]; ref: string } | null = null;
  const write = (items: CorrectionItem[], ref: string) => {
    if (!rows.some((r) => r.ref === ref)) for (const it of items) rows.push({ id: nextId++, ref, delta: it.delta });
  };
  const server = {
    down: false,
    lateFirst: true,
    landedFirst: false,
    sent: [] as Array<{ items: CorrectionItem[]; ref: string }>,
    removed: [] as number[],
    total: () => rows.reduce((sum, r) => sum + r.delta, 0),
    send: async (items: CorrectionItem[], ref: string): Promise<unknown> => {
      server.sent.push({ items, ref });
      if (server.lateFirst) {
        server.lateFirst = false;
        writing = { items, ref };
        throw new ApiError('network', 'Нет связи');
      }
      if (server.down) throw new ApiError('network', 'Нет связи');
      if (writing) {
        write(writing.items, writing.ref);
        writing = null;
      }
      write(items, ref);
      if (server.landedFirst) {
        server.landedFirst = false;
        throw new ApiError('network', 'Нет связи');
      }
      return { ok: true };
    },
    remove: async (id: number): Promise<unknown> => {
      server.removed.push(id);
      rows = rows.filter((r) => r.id !== id);
      return { ok: true };
    },
    load: async (): Promise<number> => server.total(),
  };
  return server;
}

/** Вкладка «Итоги» поверх сервера; `seen` — последняя нарисованная сумма. */
function openTab(server: ReturnType<typeof fakeServer>, pending: PendingHolder, newRef: () => string) {
  const seen = { total: 0 };
  const setStale = vi.fn();
  const flow = createResultsFlow<number>({
    send: server.send,
    remove: server.remove,
    load: server.load,
    apply: (total) => { seen.total = total; },
    setBusy: vi.fn(),
    setStale,
    newRef,
    pending,
  });
  return { flow, seen, setStale };
}

describe('createResultsFlow: потерянная запись проверяется повтором с тем же ключом, а не перечитыванием', () => {
  test('+7 клиент не дождался, сервер ещё пишет; админ вводит 8: на сервере в итоге 8, а не 15', async () => {
    const server = fakeServer();
    const { flow, seen } = openTab(server, { current: null }, refs());
    await expect(flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    expect(server.total()).toBe(0); // сервер ещё не дописал
    // «8» админ посчитал от устаревших данных
    expect(await flow.correct([item(8)])).toEqual({ result: 'changed', refreshError: null });
    expect(seen.total).toBe(7); // повтор встал в очередь за той записью, и чтение видит её
    // 8 от свежих данных — это +1
    expect(await flow.correct([item(8 - seen.total)])).toMatchObject({ result: 'saved' });
    expect(server.total()).toBe(8);
  });

  test('повтор не дошёл: новая запись не уходит, вкладка закрыта; «Обновить» повторяет запрос, пока он не пройдёт', async () => {
    const server = fakeServer();
    const { flow, seen, setStale } = openTab(server, { current: null }, refs());
    await expect(flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    server.down = true;
    await expect(flow.correct([item(8)])).rejects.toMatchObject({ code: 'network' });
    expect(setStale.mock.calls).toEqual([[true]]);
    await expect(flow.correct([item(8)])).rejects.toThrow(STALE_TEXT);
    await expect(flow.correct([item(7)])).rejects.toThrow(STALE_TEXT);
    await expect(flow.remove(5)).rejects.toThrow(STALE_TEXT);
    expect(server.sent).toHaveLength(2); // потерянный запрос и один повтор; новое не уходило
    expect((await flow.reload()).error).toMatchObject({ code: 'network' });
    expect(server.sent).toHaveLength(3);
    expect(server.sent[2]).toEqual({ items: [item(7)], ref: 'ref-1' });
    server.down = false;
    expect(await flow.reload()).toEqual({ checked: true, error: null });
    expect(server.sent[3]).toEqual({ items: [item(7)], ref: 'ref-1' });
    expect(seen.total).toBe(7);
    expect(setStale.mock.calls).toEqual([[true], [false]]);
    expect(await flow.correct([item(1)])).toMatchObject({ result: 'saved' });
    expect(server.total()).toBe(8);
  });

  test('смена вкладки админки: новая вкладка начинает «устаревшей» и повторяет запрос прежде любой записи', async () => {
    const server = fakeServer();
    const pending: PendingHolder = { current: null };
    const newRef = refs();
    const first = openTab(server, pending, newRef);
    await expect(first.flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    const second = openTab(server, pending, newRef); // вкладку закрыли и открыли снова
    expect(second.flow.stale).toBe(true);
    expect(second.setStale.mock.calls).toEqual([[true]]);
    await expect(second.flow.correct([item(1)])).rejects.toThrow(STALE_TEXT);
    await expect(second.flow.remove(5)).rejects.toThrow(STALE_TEXT);
    expect(server.sent).toHaveLength(1);
    expect(await second.flow.reload()).toEqual({ checked: true, error: null });
    expect(server.sent[1]).toEqual({ items: [item(7)], ref: 'ref-1' });
    expect(second.seen.total).toBe(7);
    expect(second.setStale.mock.calls).toEqual([[true], [false]]);
    expect(await second.flow.correct([item(1)])).toMatchObject({ result: 'saved' });
    expect(server.total()).toBe(8);
  });

  test('без неотвеченной записи новая вкладка не «устаревшая» и ничего не повторяет', async () => {
    const server = fakeServer();
    server.lateFirst = false;
    const { flow, setStale } = openTab(server, { current: null }, refs());
    expect(flow.stale).toBe(false);
    expect(setStale).not.toHaveBeenCalled();
    expect(await flow.reload()).toEqual({ checked: false, error: null });
    expect(server.sent).toHaveLength(0);
  });

  test('+7 дошёл, ответ потерян; «Отменить» на чужой строке проверяет запись, а отменённая +7 потом не воскресает', async () => {
    const server = fakeServer();
    server.lateFirst = false;
    server.landedFirst = true;
    const pending: PendingHolder = { current: null };
    const newRef = refs();
    const { flow, seen } = openTab(server, pending, newRef);
    await expect(flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    expect(server.total()).toBe(7);
    // «Отменить» на строке, которой в таблице ещё нет +7: сначала выясняется потерянная запись, ничего не удаляется
    expect(await flow.remove(99)).toEqual({ removed: false, refreshError: null });
    expect(server.removed).toEqual([]);
    expect(seen.total).toBe(7);
    expect(server.sent).toHaveLength(2); // потерянный запрос и его повтор («уже есть»)
    // на свежих данных отмена +7 (строка 1) обычная
    expect(await flow.remove(1)).toEqual({ removed: true, refreshError: null });
    expect(server.total()).toBe(0);
    // ни «Обновить», ни другая правка, ни новая вкладка +7 не воскрешают: повторять больше нечего
    expect(await flow.reload()).toEqual({ checked: false, error: null });
    expect(await flow.correct([item(3)])).toMatchObject({ result: 'saved' });
    const later = openTab(server, pending, newRef);
    expect(later.flow.stale).toBe(false);
    expect(server.total()).toBe(3);
    expect(server.sent.filter((x) => x.ref === 'ref-1')).toHaveLength(2);
  });
});
