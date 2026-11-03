import { createCorrectionSaver } from './correctionSaver';
import type { CorrectionItem } from './results';

export const BUSY_TEXT = 'Идёт запись…';
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
 */
export function createResultsFlow<S>(deps: {
  send: (items: CorrectionItem[], ref: string) => Promise<unknown>;
  remove: (id: number) => Promise<unknown>;
  load: () => Promise<S>;
  apply: (snapshot: S) => void;
  setBusy: (busy: boolean) => void;
  newRef?: () => string;
}) {
  const saver = createCorrectionSaver({ send: deps.send, newRef: deps.newRef });
  let busy = false;
  let latest = 0;

  async function refresh(): Promise<void> {
    const mine = ++latest;
    const snapshot = await deps.load();
    if (mine === latest) deps.apply(snapshot);
  }

  /** Сбой чтения не должен выдавать уже сделанную запись за неудачную. */
  const refreshQuietly = (): Promise<unknown> => refresh().then(() => null, (e: unknown) => e);

  async function exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (busy) throw new WriteRefused(BUSY_TEXT);
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
    /** Ошибку запроса пробрасывает; после неё снимок не читается. */
    correct: (items: CorrectionItem[]): Promise<WriteDone> =>
      exclusive(async () => {
        const result = await saver.save(items);
        if (result === 'busy') throw new WriteRefused(BUSY_TEXT);
        return { result, refreshError: await refreshQuietly() };
      }),
    remove: (id: number): Promise<{ refreshError: unknown }> =>
      exclusive(async () => {
        await deps.remove(id);
        // что теперь на сервере, видно из свежих данных: ожидание ответа на прошлую правку больше не нужно, иначе
        // та же правка, введённая заново, ушла бы со старым `ref` и сервер молча принял бы её за повтор
        saver.forget();
        return { refreshError: await refreshQuietly() };
      }),
  };
}
