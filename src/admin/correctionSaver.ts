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

/**
 * Запись правок одним запросом `addCorrections`. Ответ: `saved` — записано; `busy` — запрос уже идёт, ничего не
 * отправлено; `changed` — ответа на прошлый запрос не было, а правки теперь другие: ничего не отправлено.
 * Если ответа не было (обрыв, таймаут), запрос мог дойти до сервера: повтор с теми же правками уходит с тем же `ref`,
 * и сервер не запишет второй раз. Другие правки отправлять нельзя: разница с файлом посчитана от данных до той записи,
 * и вместе они дали бы лишнее (+7 потерялся, потом «8» ушло как +8 — на сервере 15). Новый `ref` тут тоже не спасает.
 * Ожидание снимает только `forget()`, и звать его можно лишь после того, как свежие данные прочитаны: `changed` само
 * его не снимает, иначе при неудачном перечитывании следующая правка ушла бы от устаревших данных.
 */
export function createCorrectionSaver(opts: {
  send: (items: CorrectionItem[], ref: string) => Promise<unknown>;
  newRef?: () => string;
}) {
  const newRef = opts.newRef ?? randomRef;
  let busy = false;
  let unanswered: { key: string; ref: string } | null = null;

  return {
    get busy(): boolean {
      return busy;
    },
    /** Забыть, что прошлый запрос остался без ответа: свежие данные уже прочитаны, правки считаются заново. */
    forget(): void {
      unanswered = null;
    },
    /** Ошибку запроса пробрасывает. */
    async save(items: CorrectionItem[]): Promise<'saved' | 'busy' | 'changed'> {
      if (busy) return 'busy';
      const key = JSON.stringify(items);
      if (unanswered && unanswered.key !== key) return 'changed';
      busy = true;
      const ref = unanswered ? unanswered.ref : newRef();
      unanswered = null;
      try {
        await opts.send(items, ref);
      } catch (e) {
        if (!wasRejected(e)) unanswered = { key, ref };
        throw e;
      } finally {
        busy = false;
      }
      return 'saved';
    },
  };
}
