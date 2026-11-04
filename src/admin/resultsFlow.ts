import { createCorrectionSaver, wasRejected, type PendingHolder } from './correctionSaver';
import type { CorrectionItem } from './results';

export const BUSY_TEXT = 'Идёт запись…';
export const STALE_TEXT = 'Данные не обновились после записи — нажмите «Обновить»';
export const INTERRUPTED_TEXT = 'Связь прерывалась: прошлая правка проверена, данные перечитаны. Проверьте значение и поправьте ещё раз, если нужно.';
export const UNRESOLVED_TEXT = 'Связь прервалась во время загрузки — нажмите «Загрузить» ещё раз (повторная загрузка того же файла безопасна).';

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
 * Запись, не являющаяся правкой (загрузка файла): `value` — что вернула сама запись; `refreshError` — сбой чтения свежего
 * снимка после неё (сама запись при этом не провалена, поток «устарел»). Загрузка без ответа сюда не попадает: `write`
 * бросает `WriteRefused` с `UNRESOLVED_TEXT`.
 */
export interface WriteResult<T> {
  value: T;
  refreshError: unknown;
}

/**
 * `removed`: правка отменена. Не отменена (`false`), если вместо этого выяснялась неотвеченная запись: отмена идёт
 * только на свежих данных, следующим нажатием. `refreshError` — сбой чтения после этого.
 */
export interface RemoveDone {
  removed: boolean;
  refreshError: unknown;
}

/** Экран вкладки «Итоги», который обслуживает поток: получает свежие данные и состояние «занято» / «устарело». */
export interface FlowView<S> {
  apply(snapshot: S): void;
  setBusy(busy: boolean): void;
  setStale(stale: boolean): void;
}

/** Открытие вкладки. Вид подключает только самое новое открытие: более старое, закончившее позже, потока не отбирает. */
export interface Opening<S> {
  /** Проверить потерянную запись прежде первого снимка: если проверка уже идёт, это та же проверка. `null` — нечего. */
  open(): Promise<ReloadDone | null>;
  /** `false`: открытие успели сменить более новым, вид не подключён. */
  attach(view: FlowView<S>): boolean;
}

/**
 * Порядок записей админки «Итоги», без DOM. ОДИН на всю страницу (его создаёт каркас): состояние «занято», «устарело»,
 * неотвеченный запрос и единственная идущая проверка принадлежат ему, а не экземпляру вкладки. Иначе два экземпляра
 * (быстрая смена вкладки при загрузке) повторяли бы запрос каждый сам: один дописал бы после отмены той правки, а
 * второй открылся бы с таблицей до проверки. Вкладка только рисует: подключает вид (`begin().attach`), и поток
 * обслуживает самый новый из них.
 *
 * Одна запись за раз (и проверка с чтением тоже): пока идёт правка, отмена или проверка, остальное отклоняется
 * (`WriteRefused`), вид получает `setBusy(true)`, вкладки админки блокирует `lockNav`. Снимок читается заново после
 * каждой записи.
 *
 * Запрос `addCorrections` без ответа (обрыв, таймаут) мог дойти или ещё дописываться на сервере. Исход узнаётся только
 * повтором того же запроса, слово в слово (те же правки, тот же `ref`): сервер запишет, если не писал, или ответит «уже
 * есть», а запись идёт под замком, так что повтор дождётся незаконченной. Перечитать данные мало: чтение замка не берёт
 * и недописанного не видит. Поэтому те же значения — это и есть повтор; другие значения сначала повторяют прошлый
 * запрос и уходят в `changed` (новые не отправляются: считались от старых данных); «Обновить», «Отменить» и открытие
 * вкладки тоже сперва повторяют. Кто бы ни попросил проверку, пока она идёт, он получает ту же проверку, второго
 * повтора нет. Не получил повтор ответа — запрос остаётся ожидать, поток «устарел», новых записей нет. Ожидание лежит в
 * `pending`, поэтому переживает смену вкладки админки.
 *
 * Пока запись не видна в свежем снимке, поток «устарел» (`setStale(true)` виду): правки и отмены отклоняются, ничего не
 * отправляя, потому что любое новое число считалось бы от таблицы, которая врёт. Так после записи, после отмены и
 * после «changed», если перечитать не удалось, и сразу, если от прошлого открытия остался неотвеченный запрос. Снимает
 * это только проверка (`reload`, `open`): повтор, если он нужен, затем чтение.
 *
 * Загрузка файла без ответа (обрыв, таймаут, ошибка сервера — не его отказ) устроена так же, как правка без ответа: сервер
 * мог её не получить, а мог ещё дописывать, и чтение это не покажет (оно замка не берёт). Исход узнаётся только повтором:
 * загрузки идемпотентны (строки воронки заменяются по паре «сотрудник, день», период оплат — целиком, штат — по ФИО) и идут
 * под замком сервера. Поэтому поток входит в состояние «загрузка без ответа» (`unresolved` — блок, чья загрузка не
 * подтверждена): он «устарел», правки и отмены отклоняются, «Обновить» и открытие вкладки данные читают, но «устарело» не
 * снимают, и выйти можно только повтором загрузки того же блока, получившим определённый ответ (успех или отказ сервера).
 * Загрузка другого блока не годится: её ответ не говорит, дописана ли первая. Состояние живёт в потоке, то есть переживает
 * смену вкладки админки (обновление страницы его теряет, как и неотвеченную правку).
 */
export function createResultsFlow<S>(deps: {
  send: (items: CorrectionItem[], ref: string) => Promise<unknown>;
  remove: (id: number) => Promise<unknown>;
  load: () => Promise<S>;
  /** Заблокировать (true) или вернуть (false) вкладки админки и «Выйти»: на время записи их трогать нельзя. */
  lockNav?: (locked: boolean) => void;
  pending?: PendingHolder;
  newRef?: () => string;
}) {
  const saver = createCorrectionSaver({ send: deps.send, newRef: deps.newRef, pending: deps.pending });
  let view: FlowView<S> | null = null;
  let generation = 0;
  let busy = false;
  let stale = saver.hasPending; // от прошлого открытия мог остаться запрос без ответа: писать нельзя, пока его не повторят
  let unresolved: string | null = null; // блок, чья загрузка осталась без ответа: пока он не повторён, поток «устарел»
  let running: Promise<unknown> | null = null;
  let checking: Promise<ReloadDone> | null = null;

  const setStale = (value: boolean): void => {
    if (stale === value) return;
    stale = value;
    view?.setStale(value);
  };

  /** Чтение под замком, поэтому два чтения не обгоняют друг друга. Сбой чтения не провал сделанной записи. */
  async function refreshQuietly(): Promise<unknown> {
    try {
      const snapshot = await deps.load();
      view?.apply(snapshot);
    } catch (e) {
      return e;
    }
    if (unresolved === null) setStale(false); // свежесть чтения не снимает «загрузка без ответа»: чтение могло опередить запись
    return null;
  }

  /** После записи: перечитать снимок; не вышло — поток устарел, пока чтение не удастся. */
  async function settle(): Promise<unknown> {
    const error = await refreshQuietly();
    if (error) setStale(true);
    return error;
  }

  /** Выяснить неотвеченную запись (если есть) повтором и прочитать снимок. Повтор без ответа — ожидание остаётся, поток устарел. */
  function check(): Promise<ReloadDone> {
    const done = (async (): Promise<ReloadDone> => {
      let checked: boolean;
      try {
        checked = await saver.resolve();
      } catch (error) {
        setStale(true);
        return { checked: false, error };
      }
      return { checked, error: await settle() };
    })().finally(() => {
      checking = null;
    });
    checking = done;
    return done;
  }

  /** `write`: запись, а не чтение. Её отклоняет и «устаревший» поток; отказ приходит до `setBusy`, вид не мигает. */
  async function exclusive<T>(run: () => Promise<T>, write = true, resolving?: string): Promise<T> {
    if (busy) throw new WriteRefused(BUSY_TEXT);
    // `resolving` — блок, чья загрузка без ответа: его повтор единственная запись, которой «устарело» не мешает
    if (write && stale && !(resolving !== undefined && resolving === unresolved)) {
      throw new WriteRefused(unresolved === null ? STALE_TEXT : UNRESOLVED_TEXT);
    }
    busy = true;
    view?.setBusy(true);
    deps.lockNav?.(true);
    const op = run();
    running = op;
    try {
      return await op;
    } finally {
      busy = false;
      running = null;
      view?.setBusy(false);
      deps.lockNav?.(false);
    }
  }

  /** Открытие вкладки: дождаться идущей проверки или записи, иначе, если надо, проверить самому. */
  async function open(): Promise<ReloadDone | null> {
    if (checking) return checking;
    if (running) {
      await running.catch(() => undefined);
      return open();
    }
    if (!stale && !saver.hasPending) return null;
    return exclusive(check, false);
  }

  return {
    get busy(): boolean {
      return busy;
    },
    get stale(): boolean {
      return stale;
    },
    /** Блок («funnel», «payments»), чья загрузка осталась без ответа; `null` — такой нет. */
    get unresolved(): string | null {
      return unresolved;
    },
    /** Что сказать на месте «устарело»: «Обновить» не поможет, пока не повторена загрузка без ответа. */
    get staleText(): string {
      return unresolved === null ? STALE_TEXT : UNRESOLVED_TEXT;
    },
    /** Можно ли сейчас нажимать «Загрузить» этого блока: не занято, не «устарело» (кроме повтора загрузки без ответа). */
    canWrite(key: string): boolean {
      return !busy && (!stale || unresolved === key);
    },
    /** Новое открытие вкладки (см. `Opening`). */
    begin(): Opening<S> {
      const mine = ++generation;
      return {
        open,
        attach(next) {
          if (mine !== generation) return false;
          view = next;
          if (stale) next.setStale(true);
          if (busy) next.setBusy(true);
          return true;
        },
      };
    },
    /** «Обновить»: повторить неотвеченный запрос (если он есть), затем прочитать снимок. Идёт проверка — та же проверка. */
    reload: (): Promise<ReloadDone> => checking ?? exclusive(check, false),
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
    /**
     * Любая другая запись страницы (загрузка файла блока `key`) под тем же замком: одна запись за раз, вкладки админки
     * заблокированы на всё время, отклоняется, пока поток «устарел» или правка без ответа не выяснена (тогда он «устаревает»:
     * «Обновить» повторит запрос). Определённый ответ (успех или отказ сервера) — снимок читается заново и раздаётся виду;
     * отказ пробрасывается как есть. Ответа не было — исход неизвестен: поток входит в «загрузка без ответа» этого блока,
     * снимок не читается, бросается `WriteRefused` с `UNRESOLVED_TEXT`; повтор того же блока при «устарело» разрешён.
     */
    write: <T>(key: string, run: () => Promise<T>): Promise<WriteResult<T>> =>
      exclusive(async () => {
        if (saver.hasPending) {
          setStale(true);
          throw new WriteRefused(STALE_TEXT);
        }
        /** Определённый ответ закрывает и прежнюю загрузку без ответа (это её повтор): читаем снимок после записи. */
        const answered = async (): Promise<unknown> => {
          const repeat = unresolved === key;
          if (repeat) unresolved = null;
          const error = await settle();
          if (error && repeat) view?.setStale(true); // всё ещё «устарело», но по обычной причине: вид меняет текст
          return error;
        };
        let value: T;
        try {
          value = await run();
        } catch (e) {
          if (wasRejected(e)) {
            await answered();
            throw e;
          }
          unresolved = key;
          stale = true;
          view?.setStale(true);
          throw new WriteRefused(UNRESOLVED_TEXT);
        }
        return { value, refreshError: await answered() };
      }, true, key),
    remove: (id: number): Promise<RemoveDone> =>
      exclusive(async () => {
        if (saver.hasPending) {
          const done = await check();
          if (!done.checked) throw done.error; // повтор без ответа: ничего не удалено, поток устарел
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

/** Тип общего потока, как его видят вкладки. */
export type ResultsFlow<S> = ReturnType<typeof createResultsFlow<S>>;
