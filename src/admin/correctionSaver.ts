import { ApiError } from '@/data/api';
import type { CorrectionItem } from './results';

/** Случайный `ref` запроса (сервер принимает до 64 символов): UUID, а без `crypto.randomUUID` — случайные байты в hex. */
export function randomRef(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Ответ сервера «нет» без записи: повторять тот же `ref` незачем. */
const REJECTED = new Set(['bad_request', 'invalid_pin', 'locked']);

/** Сервер ответил отказом: записи не было. Любая другая ошибка — результат неизвестен. */
export const wasRejected = (e: unknown): boolean => e instanceof ApiError && REJECTED.has(e.code);

/** Запрос `addCorrections`, на который не пришёл ответ: правки и `ref`, чтобы повторить его слово в слово. */
export interface PendingWrite {
  items: CorrectionItem[];
  ref: string;
}

/**
 * Держатель такого запроса. Его создаёт каркас админки, а не вкладка: вкладку можно закрыть, а запись на сервере всё ещё
 * может дописываться (Apps Script стартует до ~35 с, ответа ждём 30), и новая вкладка обязана проверить её повтором.
 */
export interface PendingHolder {
  current: PendingWrite | null;
}

/**
 * Запись правок одним запросом `addCorrections`. Ответ: `saved` — записано; `busy` — запрос уже идёт, ничего не
 * отправлено; `changed` — ответа на прошлый запрос не было, а правки теперь другие: отправлен только повтор прошлого
 * запроса (те же правки, тот же `ref`), новые правки не отправлены.
 *
 * Если ответа не было (обрыв, таймаут), запрос мог дойти до сервера или ещё дописываться там. Узнать исход можно лишь
 * повтором: сервер запишет, если не записывал, или ответит «уже есть» (повтор с тем же `ref` второй раз не пишет), а
 * записи идут под замком, поэтому повтор дождётся незаконченной. Перечитать данные для этого мало: чтение замка не
 * берёт и недописанного не видит. Новые правки от старых данных тоже слать нельзя: +7 потерялся, «8» ушло бы как +8,
 * а на сервере уже 7 — итого 15. Ответ на повтор (запись или отказ `bad_request`) снимает ожидание; ошибка — нет.
 */
export function createCorrectionSaver(opts: {
  send: (items: CorrectionItem[], ref: string) => Promise<unknown>;
  newRef?: () => string;
  pending?: PendingHolder;
}) {
  const newRef = opts.newRef ?? randomRef;
  const pending = opts.pending ?? { current: null };
  let busy = false;

  /** Повтор слово в слово. Ответ сервера (в том числе отказ) снимает ожидание; любая ошибка пробрасывается. */
  async function sendPending(p: PendingWrite): Promise<void> {
    try {
      await opts.send(p.items, p.ref);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'bad_request') pending.current = null;
      throw e;
    }
    pending.current = null;
  }

  /** То же, но отказ сервера не ошибка: ответ получен, ожидание снято. */
  async function replay(p: PendingWrite): Promise<void> {
    try {
      await sendPending(p);
    } catch (e) {
      if (pending.current !== null) throw e;
    }
  }

  /** Есть ожидание, и правки не те же: такая запись сначала повторит прошлую. */
  const differs = (items: CorrectionItem[]): boolean =>
    pending.current !== null && JSON.stringify(pending.current.items) !== JSON.stringify(items);

  return {
    get busy(): boolean {
      return busy;
    },
    get hasPending(): boolean {
      return pending.current !== null;
    },
    differs,
    /** Повторить неотвеченный запрос (если он есть). `true` — повтор получил ответ; ошибку пробрасывает. */
    async resolve(): Promise<boolean> {
      const p = pending.current;
      if (!p) return false;
      busy = true;
      try {
        await replay(p);
      } finally {
        busy = false;
      }
      return true;
    },
    /** Ошибку запроса пробрасывает. */
    async save(items: CorrectionItem[]): Promise<'saved' | 'busy' | 'changed'> {
      if (busy) return 'busy';
      busy = true;
      try {
        const p = pending.current;
        if (p) {
          if (differs(items)) {
            await replay(p);
            return 'changed';
          }
          await sendPending(p);
          return 'saved';
        }
        const ref = newRef();
        try {
          await opts.send(items, ref);
        } catch (e) {
          if (!wasRejected(e)) pending.current = { items: items.map((i) => ({ ...i })), ref };
          throw e;
        }
        return 'saved';
      } finally {
        busy = false;
      }
    },
  };
}
