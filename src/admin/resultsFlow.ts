import { createCorrectionSaver, wasRejected, type PendingHolder } from './correctionSaver';
import type { CorrectionItem } from './results';

export const BUSY_TEXT = 'Идёт запись…';
export const STALE_TEXT = 'Данные не обновились после записи — нажмите «Обновить»';
export const INTERRUPTED_TEXT = 'Связь прерывалась: прошлая правка проверена, данные перечитаны. Проверьте значение и поправьте ещё раз, если нужно.';

/** Запись не начата по понятной человеку причине: `message` показывается как есть. */
export class WriteRefused extends Error {}

/**
 * `result`: `saved` — правка записана; `changed` — прошлый запрос остался без ответа, а значения теперь другие:
 * повторён только он, новые не отправлены, данные перечитаны. `refreshError` — сбой чтения свежего снимка после этого
 * (сама запись при этом не провалена).
 */
export interface WriteDone {
  result: 'saved' | 'changed';
  refreshError: unknown;
}

/**
 * `checked`: был неотвеченный запрос, и повтор получил ответ. `error`: повтор или чтение не удались (иначе null).
 */
export interface ReloadDone {
  checked: boolean;
  error: unknown;
}

/**
 * `removed`: правка отменена. Не отменена (`false`), если вместо этого выяснялась неотвеченная запись: отмена идёт
 * только на свежих данных, следующим нажатием. `refreshError` — сбой чтения после этого.
 */
export interface RemoveDone {
  removed: boolean;
  refreshError: unknown;
}

/**
 * Порядок записей вкладки «Итоги», без DOM. Одна запись за раз (и чтения тоже): пока идёт правка, отмена или
 * «Обновить», остальное отклоняется (`WriteRefused`), а `setBusy(true)` блокирует всю вкладку. Снимок читается заново
 * после каждой записи.
 *
 * Запрос `addCorrections` без ответа (обрыв, таймаут) мог дойти или ещё дописываться на сервере. Исход узнаётся только
 * повтором того же запроса, слово в слово (те же правки, тот же `ref`): сервер запишет, если не писал, или ответит «уже
 * есть», а запись идёт под замком, так что повтор дождётся незаконченной. Перечитать данные мало: чтение замка не берёт
 * и недописанного не видит. Поэтому те же значения — это и есть повтор; другие значения сначала повторяют прошлый
 * запрос и уходят в `changed` (новые не отправляются: считались от старых данных); «Обновить» и новая вкладка тоже
 * сперва повторяют. Не получил повтор ответа — запрос остаётся ожидать, вкладка «устарела», новых записей нет.
 * «Отменить» при неотвеченной записи тоже ничего не удаляет, а выясняет её (повтор, чтение): удаляют по номеру строки,
 * и отменённая правка оставила бы ожидание, чей повтор потом записал бы её заново. Ожидание лежит в `pending` вне
 * вкладки, чтобы пережить смену вкладки админки.
 *
 * Пока запись не видна в свежем снимке, вкладка «устарела» (`setStale(true)`): правки и отмены отклоняются, ничего не
 * отправляя, потому что любое новое число считалось бы от таблицы, которая врёт. Так после записи, после отмены и
 * после «changed», если перечитать не удалось, и сразу в новой вкладке, если от прошлой остался неотвеченный запрос.
 * Снимает это только `reload` («Обновить»): повтор, если он нужен, затем чтение.
 */
export function createResultsFlow<S>(deps: {
  send: (items: CorrectionItem[], ref: string) => Promise<unknown>;
  remove: (id: number) => Promise<unknown>;
  load: () => Promise<S>;
  apply: (snapshot: S) => void;
  setBusy: (busy: boolean) => void;
  setStale: (stale: boolean) => void;
  pending?: PendingHolder;
  newRef?: () => string;
}) {
  const saver = createCorrectionSaver({ send: deps.send, newRef: deps.newRef, pending: deps.pending });
  let busy = false;
  let stale = false;

  const setStale = (value: boolean): void => {
    if (stale === value) return;
    stale = value;
    deps.setStale(value);
  };
  // от прошлой вкладки остался запрос без ответа: писать нельзя, пока его не повторят
  if (saver.hasPending) setStale(true);

  /** Чтение под замком вкладки, поэтому два чтения не обгоняют друг друга. Сбой чтения не провал сделанной записи. */
  async function refreshQuietly(): Promise<unknown> {
    try {
      deps.apply(await deps.load());
    } catch (e) {
      return e;
    }
    setStale(false);
    return null;
  }

  /** После записи: перечитать снимок; не вышло — вкладка устарела, пока чтение не удастся. */
  async function settle(): Promise<unknown> {
    const error = await refreshQuietly();
    if (error) setStale(true);
    return error;
  }

  /** Выяснить неотвеченную запись (если есть) повтором и прочитать снимок. Повтор без ответа — ожидание остаётся, вкладка устарела. */
  async function check(): Promise<ReloadDone> {
    let checked: boolean;
    try {
      checked = await saver.resolve();
    } catch (error) {
      setStale(true);
      return { checked: false, error };
    }
    return { checked, error: await settle() };
  }

  /** `write`: запись, а не чтение. Её отклоняет и «устаревшая» вкладка; отказ приходит до `setBusy`, вкладка не мигает. */
  async function exclusive<T>(run: () => Promise<T>, write = true): Promise<T> {
    if (busy) throw new WriteRefused(BUSY_TEXT);
    if (write && stale) throw new WriteRefused(STALE_TEXT);
    busy = true;
    deps.setBusy(true);
    try {
      return await run();
    } finally {
      busy = false;
      deps.setBusy(false);
    }
  }

  return {
    get busy(): boolean {
      return busy;
    },
    get stale(): boolean {
      return stale;
    },
    /** «Обновить» и открытие вкладки: повторить неотвеченный запрос (если он есть), затем прочитать снимок заново. */
    reload: (): Promise<ReloadDone> => exclusive(check, false),
    /** Ошибку запроса пробрасывает; после неё снимок не читается (потерянный ответ берёт под охрану `saver`). */
    correct: (items: CorrectionItem[]): Promise<WriteDone> =>
      exclusive(async () => {
        const other = saver.differs(items);
        let result: Awaited<ReturnType<typeof saver.save>>;
        try {
          result = await saver.save(items);
        } catch (e) {
          // повтор прошлого запроса не получил ответа: его исход неизвестен, новых записей нет, пока он не пройдёт
          if (other) setStale(true);
          throw e;
        }
        if (result === 'busy') throw new WriteRefused(BUSY_TEXT);
        return { result, refreshError: await settle() };
      }),
    remove: (id: number): Promise<RemoveDone> =>
      exclusive(async () => {
        if (saver.hasPending) {
          const done = await check();
          if (!done.checked) throw done.error; // повтор без ответа: ничего не удалено, вкладка устарела
          return { removed: false, refreshError: done.error };
        }
        try {
          await deps.remove(id);
        } catch (e) {
          // ответа не было: отмена могла дойти, а таблица её не показывает — перечитываем, не вышло — «устарело»
          if (!wasRejected(e)) await settle();
          throw e;
        }
        return { removed: true, refreshError: await settle() };
      }),
  };
}
