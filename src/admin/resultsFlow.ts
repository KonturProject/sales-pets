import { createCorrectionSaver, wasRejected } from './correctionSaver';
import type { CorrectionItem } from './results';

export const BUSY_TEXT = 'Идёт запись…';
export const STALE_TEXT = 'Данные не обновились после записи — нажмите «Обновить»';
export const INTERRUPTED_TEXT = 'Связь прерывалась: данные перечитаны. Проверьте значение и поправьте ещё раз, если нужно.';

/** Запись не начата по понятной человеку причине: `message` показывается как есть. */
export class WriteRefused extends Error {}

/**
 * `result`: `saved` — правка записана; `changed` — после обрыва связи значения другие, запрос не отправлен, данные
 * перечитаны. `refreshError` — сбой чтения свежего снимка после этого (сама запись при этом не провалена).
 */
export interface WriteDone {
  result: 'saved' | 'changed';
  refreshError: unknown;
}

/**
 * Порядок записей вкладки «Итоги», без DOM. Одна запись за раз: пока идёт правка или отмена, вторая отклоняется
 * (`WriteRefused`), а `setBusy(true)` блокирует всю вкладку. После записи снимок читается заново; из нескольких
 * чтений рисуется только самое новое. Правка после обрыва связи: те же значения — тот же `ref` (сервер узнает
 * повтор), другие — запрос не уходит, потому что первая запись могла дойти, а разница считалась от старых данных.
 *
 * Пока запись не видна в свежем снимке, вкладка «устарела» (`setStale(true)`): правки и отмены отклоняются, ничего не
 * отправляя, потому что любое новое число считалось бы от таблицы, которая врёт. Так после записи, после отмены и
 * после «changed», если перечитать не удалось. Снимает это только удачное чтение («Обновить» — `reload`): оно же
 * забывает ожидание ответа на потерянный запрос (`forget`).
 */
export function createResultsFlow<S>(deps: {
  send: (items: CorrectionItem[], ref: string) => Promise<unknown>;
  remove: (id: number) => Promise<unknown>;
  load: () => Promise<S>;
  apply: (snapshot: S) => void;
  setBusy: (busy: boolean) => void;
  setStale: (stale: boolean) => void;
  newRef?: () => string;
}) {
  const saver = createCorrectionSaver({ send: deps.send, newRef: deps.newRef });
  let busy = false;
  let stale = false;
  let latest = 0;

  const setStale = (value: boolean): void => {
    if (stale === value) return;
    stale = value;
    deps.setStale(value);
  };

  async function refresh(): Promise<void> {
    const mine = ++latest;
    const snapshot = await deps.load();
    if (mine !== latest) return;
    deps.apply(snapshot);
    // свежие данные прочитаны и нарисованы: писать снова можно, а ожидание ответа на потерянный запрос уже не нужно —
    // иначе следующее другое значение получило бы лишний «changed» после перечитывания, которое уже всё показало
    saver.forget();
    setStale(false);
  }

  /** Сбой чтения не должен выдавать уже сделанную запись за неудачную. */
  const refreshQuietly = (): Promise<unknown> => refresh().then(() => null, (e: unknown) => e);

  /** После записи: перечитать снимок; не вышло — вкладка устарела, пока чтение не удастся. */
  async function settle(): Promise<unknown> {
    const error = await refreshQuietly();
    if (error) setStale(true);
    return error;
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
    refresh,
    get busy(): boolean {
      return busy;
    },
    /** «Обновить»: прочитать снимок заново. Возвращает ошибку чтения или null; если вкладка устарела, чтение её «чинит». */
    reload: (): Promise<unknown> => exclusive(refreshQuietly, false),
    /** Ошибку запроса пробрасывает; после неё снимок не читается (потерянный ответ берёт под охрану `saver`). */
    correct: (items: CorrectionItem[]): Promise<WriteDone> =>
      exclusive(async () => {
        const result = await saver.save(items);
        if (result === 'busy') throw new WriteRefused(BUSY_TEXT);
        return { result, refreshError: await settle() };
      }),
    remove: (id: number): Promise<{ refreshError: unknown }> =>
      exclusive(async () => {
        try {
          await deps.remove(id);
        } catch (e) {
          // ответа не было: отмена могла дойти, а таблица её не показывает — перечитываем, не вышло — «устарело»
          if (!wasRejected(e)) await settle();
          throw e;
        }
        return { refreshError: await settle() };
      }),
  };
}
