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
  const flow = createResultsFlow<number>({ send: mocks.send, remove: mocks.remove, load: mocks.load, newRef: refs(), pending });
  flow.begin().attach({ apply: mocks.apply, setBusy: mocks.setBusy, setStale: mocks.setStale });
  return { flow, ...mocks };
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
 * (`lateFirst`), либо запись дошла, а ответ потерян (`landedFirst`). `gate` задерживает запросы (медленный повтор),
 * `events` — порядок: `send:<ref>` в момент, когда запись обработана, и `load`.
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
    gate: null as Promise<void> | null,
    events: [] as string[],
    sent: [] as Array<{ items: CorrectionItem[]; ref: string }>,
    removed: [] as number[],
    total: () => rows.reduce((sum, r) => sum + r.delta, 0),
    send: async (items: CorrectionItem[], ref: string): Promise<unknown> => {
      server.sent.push({ items, ref });
      if (server.gate) await server.gate;
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
      server.events.push(`send:${ref}`);
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
    load: async (): Promise<number> => {
      server.events.push('load');
      return server.total();
    },
  };
  return server;
}

/** Вид вкладки: что ему последним пришло от потока. */
function fakeView() {
  const view = {
    total: 0,
    stale: false,
    busy: false,
    attached: false,
    apply: (total: number) => { view.total = total; },
    setBusy: (busy: boolean) => { view.busy = busy; },
    setStale: (stale: boolean) => { view.stale = stale; },
  };
  return view;
}

/** Одна вкладка «Итоги» поверх сервера; `seen` — последняя нарисованная сумма. */
function openTab(server: ReturnType<typeof fakeServer>, pending: PendingHolder, newRef: () => string) {
  const seen = { total: 0 };
  const setStale = vi.fn();
  const flow = createResultsFlow<number>({ send: server.send, remove: server.remove, load: server.load, newRef, pending });
  flow.begin().attach({ apply: (total) => { seen.total = total; }, setBusy: vi.fn(), setStale });
  return { flow, seen, setStale };
}

/**
 * Страница админки: ОДИН поток записи на все открытия вкладки. `render` — то, что делает вкладка при открытии:
 * общая проверка потерянной записи, и только потом первый снимок и показ (подключение вида).
 */
function openPage(server: ReturnType<typeof fakeServer>, pending: PendingHolder = { current: null }) {
  const flow = createResultsFlow<number>({ send: server.send, remove: server.remove, load: server.load, newRef: refs(), pending });
  async function render() {
    const opening = flow.begin();
    const checked = await opening.open();
    const view = fakeView();
    view.total = await server.load();
    view.attached = opening.attach(view);
    return { view, checked };
  }
  return { flow, render };
}

const lostPlus7 = (): PendingHolder => ({ current: { items: [item(7)], ref: 'ref-0' } }); // +7 потерян и до сервера не дошёл

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

  test('смена вкладки админки: новое открытие проверяет запись до первого снимка и показывается не «устаревшим»', async () => {
    const server = fakeServer();
    const page = openPage(server);
    await page.render();
    await expect(page.flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    const reopened = await page.render(); // вкладку закрыли и открыли снова
    expect(reopened.checked).toEqual({ checked: true, error: null });
    expect(server.sent[1]).toEqual({ items: [item(7)], ref: 'ref-1' });
    expect(reopened.view.total).toBe(7); // первый снимок уже после проверки
    expect(reopened.view.stale).toBe(false);
    expect(await page.flow.correct([item(1)])).toMatchObject({ result: 'saved' });
    expect(server.total()).toBe(8);
  });

  test('смена вкладки, повтор не прошёл: вид подключается «устаревшим» с первого кадра, записи закрыты', async () => {
    const server = fakeServer();
    const page = openPage(server);
    await page.render();
    await expect(page.flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    server.down = true;
    const reopened = await page.render();
    expect(reopened.checked?.error).toMatchObject({ code: 'network' });
    expect(reopened.view.stale).toBe(true);
    await expect(page.flow.correct([item(1)])).rejects.toThrow(STALE_TEXT);
    await expect(page.flow.remove(5)).rejects.toThrow(STALE_TEXT);
    expect(server.sent).toHaveLength(2);
    server.down = false;
    expect(await page.flow.reload()).toEqual({ checked: true, error: null });
    expect(reopened.view.stale).toBe(false);
    expect(await page.flow.correct([item(1)])).toMatchObject({ result: 'saved' });
  });

  test('без неотвеченной записи открытие ничего не повторяет: только свой снимок', async () => {
    const server = fakeServer();
    server.lateFirst = false;
    const page = openPage(server);
    const opened = await page.render();
    expect(opened.checked).toBeNull();
    expect(opened.view.stale).toBe(false);
    expect(server.sent).toHaveLength(0);
    expect(server.events).toEqual(['load']);
  });

  test('+7 дошёл, ответ потерян; «Отменить» на чужой строке проверяет запись, а отменённая +7 потом не воскресает', async () => {
    const server = fakeServer();
    server.lateFirst = false;
    server.landedFirst = true;
    const page = openPage(server);
    const { view } = await page.render();
    await expect(page.flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    expect(server.total()).toBe(7);
    // «Отменить» на строке, которой в таблице ещё нет +7: сначала выясняется потерянная запись, ничего не удаляется
    expect(await page.flow.remove(99)).toEqual({ removed: false, refreshError: null });
    expect(server.removed).toEqual([]);
    expect(view.total).toBe(7);
    expect(server.sent).toHaveLength(2); // потерянный запрос и его повтор («уже есть»)
    // на свежих данных отмена +7 (строка 1) обычная
    expect(await page.flow.remove(1)).toEqual({ removed: true, refreshError: null });
    expect(server.total()).toBe(0);
    // ни «Обновить», ни другая правка, ни новое открытие +7 не воскрешают: повторять больше нечего
    expect(await page.flow.reload()).toEqual({ checked: false, error: null });
    expect(await page.flow.correct([item(3)])).toMatchObject({ result: 'saved' });
    const later = await page.render();
    expect(later.checked).toBeNull();
    expect(later.view.stale).toBe(false);
    expect(server.total()).toBe(3);
    expect(server.sent.filter((x) => x.ref === 'ref-1')).toHaveLength(2);
  });
});

describe('createResultsFlow: одно состояние записи на всю админку', () => {
  test('(a) два открытия подряд при медленном повторе: повтор один, отменённая +7 потом не воскресает', async () => {
    const server = fakeServer();
    server.lateFirst = false;
    const gate = hold();
    server.gate = gate.promise; // повтор медленный: холодный старт или очередь на замок
    const page = openPage(server, lostPlus7());
    const hidden = page.render(); // первое открытие, пользователь успел уйти
    const visible = page.render(); // и вернулся
    gate.resolve();
    const [h, v] = await Promise.all([hidden, visible]);
    expect(server.sent).toEqual([{ items: [item(7)], ref: 'ref-0' }]); // ровно один повтор на двоих
    expect(h.checked).toEqual({ checked: true, error: null });
    expect(v.checked).toEqual({ checked: true, error: null });
    expect(v.view.attached).toBe(true);
    expect(h.view.attached).toBe(false); // более старое открытие вид не подключило
    expect(v.view.total).toBe(7);
    // админ отменяет +7 на свежих данных
    expect(await page.flow.remove(1)).toEqual({ removed: true, refreshError: null });
    expect(server.total()).toBe(0);
    // позднего повтора от скрытого открытия нет: на сервере по-прежнему 0
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(server.total()).toBe(0);
    expect(server.sent).toHaveLength(1);
  });

  test('(b) второе открытие читает первый снимок только после общей проверки: таблица с +7, повторный ввод не даёт +14', async () => {
    const server = fakeServer();
    server.lateFirst = false;
    const gate = hold();
    server.gate = gate.promise;
    const page = openPage(server, lostPlus7());
    const hidden = page.render();
    const visible = page.render();
    gate.resolve();
    const [, v] = await Promise.all([hidden, visible]);
    expect(server.events[0]).toBe('send:ref-0'); // ни одного чтения до проверки
    expect(server.events.slice(1).every((e) => e === 'load')).toBe(true);
    expect(v.view.stale).toBe(false);
    expect(v.view.total).toBe(7); // таблица уже с +7
    // админ хочет 10: от свежей таблицы это +3, а не +10 поверх невидимой +7
    expect(await page.flow.correct([item(10 - v.view.total)])).toMatchObject({ result: 'saved' });
    expect(server.total()).toBe(10);
  });

  test('«Обновить» во время общей проверки получает тот же результат, а не второй повтор', async () => {
    const server = fakeServer();
    server.lateFirst = false;
    const gate = hold();
    server.gate = gate.promise;
    const page = openPage(server, lostPlus7());
    const opening = page.flow.begin().open();
    const reload = page.flow.reload();
    const again = page.flow.begin().open();
    gate.resolve();
    expect(await Promise.all([opening, reload, again])).toEqual(Array(3).fill({ checked: true, error: null }));
    expect(server.sent).toHaveLength(1);
  });

  test('вид подключает только самое новое открытие; более старое, закончившее позже, не отбирает поток', async () => {
    const flow = createResultsFlow<number>({ send: vi.fn(), remove: vi.fn(), load: vi.fn(async () => 1) });
    const [viewA, viewB] = [fakeView(), fakeView()];
    const older = flow.begin();
    const newer = flow.begin();
    expect(newer.attach(viewB)).toBe(true);
    expect(older.attach(viewA)).toBe(false);
    await flow.reload();
    expect(viewB.total).toBe(1);
    expect(viewA.total).toBe(0);
    expect(viewA.busy).toBe(false);
  });

  test('вид, подключённый к «устаревшему» или занятому потоку, сразу получает его состояние', async () => {
    const gate = hold<unknown>();
    const flow = createResultsFlow<number>({ send: vi.fn().mockReturnValue(gate.promise), remove: vi.fn(), load: vi.fn(async () => 1), pending: lostPlus7() });
    const stale = fakeView();
    flow.begin().attach(stale);
    expect(stale.stale).toBe(true);
    expect(stale.busy).toBe(false);
    const reloading = flow.reload(); // повтор висит: поток занят
    const busy = fakeView();
    flow.begin().attach(busy);
    expect(busy.busy).toBe(true);
    expect(busy.stale).toBe(true);
    gate.resolve({ ok: true });
    await reloading;
    expect(busy.busy).toBe(false);
    expect(busy.stale).toBe(false);
  });
});

describe('createResultsFlow: запись, не правка (загрузка файла)', () => {
  const boom = new ApiError('network', 'Нет связи');

  test('write: запись под замком страницы, свежий снимок читается после неё и применяется, замок вкладок на всё время', async () => {
    const order: string[] = [];
    const lockNav = vi.fn((locked: boolean) => { order.push(locked ? 'lock' : 'unlock'); });
    const apply = vi.fn(() => { order.push('apply'); });
    const flow = createResultsFlow<number>({
      send: vi.fn(), remove: vi.fn(), load: vi.fn(async () => { order.push('load'); return 7; }), lockNav,
    });
    flow.begin().attach({ apply, setBusy: vi.fn(), setStale: vi.fn() });
    expect(await flow.write(async () => { order.push('run'); return 'готово'; })).toEqual({ value: 'готово', refreshError: null });
    expect(order).toEqual(['lock', 'run', 'load', 'apply', 'unlock']);
    expect(apply).toHaveBeenCalledWith(7);
    expect(flow.busy).toBe(false);
  });

  test('пока идёт загрузка, правка, отмена и вторая загрузка отклоняются и ничего не отправляют; и наоборот', async () => {
    const gate = hold<string>();
    const { flow, send, remove } = setup();
    const importing = flow.write(() => gate.promise);
    expect(flow.busy).toBe(true);
    await expect(flow.correct([item(1)])).rejects.toThrow(BUSY_TEXT);
    await expect(flow.remove(5)).rejects.toThrow(BUSY_TEXT);
    const second = vi.fn();
    await expect(flow.write(second)).rejects.toBeInstanceOf(WriteRefused);
    expect(send).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    gate.resolve('ok');
    await importing;

    const sendGate = hold<unknown>();
    const other = setup({ send: vi.fn().mockReturnValue(sendGate.promise) });
    const saving = other.flow.correct([item(1)]);
    const run = vi.fn();
    await expect(other.flow.write(run)).rejects.toThrow(BUSY_TEXT);
    expect(run).not.toHaveBeenCalled();
    sendGate.resolve({ ok: true });
    await saving;
  });

  test('поток «устарел» (запись правки прошла, снимок не прочитан): загрузка не выполняется, пока не «Обновить»', async () => {
    const load = vi.fn().mockRejectedValueOnce(boom).mockResolvedValue(3);
    const { flow } = setup({ load });
    await flow.correct([item(1)]);
    expect(flow.stale).toBe(true);
    const run = vi.fn();
    await expect(flow.write(run)).rejects.toThrow(STALE_TEXT);
    expect(run).not.toHaveBeenCalled();
    await flow.reload();
    expect(await flow.write(async () => 1)).toMatchObject({ value: 1 });
  });

  test('правка без ответа (повтор ещё не прошёл): загрузка не выполняется, поток «устаревает», «Обновить» повторяет запрос', async () => {
    const send = vi.fn().mockRejectedValueOnce(boom).mockResolvedValue({ ok: true });
    const { flow, setStale } = setup({ send });
    await expect(flow.correct([item(7)])).rejects.toMatchObject({ code: 'network' });
    expect(flow.stale).toBe(false); // состояние «ожидает» есть, а «устарело» ещё не объявлено
    const run = vi.fn();
    await expect(flow.write(run)).rejects.toThrow(STALE_TEXT);
    expect(run).not.toHaveBeenCalled();
    expect(flow.stale).toBe(true);
    expect(setStale).toHaveBeenCalledWith(true);
    expect(await flow.reload()).toEqual({ checked: true, error: null });
    expect(send.mock.calls.map((c) => c[1])).toEqual(['ref-1', 'ref-1']);
    expect(await flow.write(async () => 'ok')).toMatchObject({ value: 'ok' });
  });

  test('загрузка прошла, а снимок прочитать не удалось: ошибка чтения отдельно, поток «устарел»', async () => {
    const { flow, apply, setStale } = setup({ load: vi.fn().mockRejectedValue(boom) });
    expect(await flow.write(async () => 'ok')).toEqual({ value: 'ok', refreshError: boom });
    expect(apply).not.toHaveBeenCalled();
    expect(setStale.mock.calls).toEqual([[true]]);
  });

  test('загрузка оборвалась: ошибка пробрасывается, а снимок всё равно перечитан (часть записей могла дойти)', async () => {
    const { flow, apply, setBusy } = setup();
    await expect(flow.write(async () => { throw boom; })).rejects.toBe(boom);
    expect(apply).toHaveBeenCalledWith(1);
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(flow.busy).toBe(false);
  });
});
