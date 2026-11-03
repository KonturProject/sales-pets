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

/**
 * Запись правок одним запросом `addCorrections`. Пока запрос идёт, второй вызов игнорируется. Если ответа не было
 * (обрыв, таймаут), запрос мог дойти до сервера: повтор с теми же правками уходит с тем же `ref`, и сервер не запишет
 * второй раз. Другие правки (админ поправил число) получают новый `ref`: иначе сервер ответил бы прежними `id`
 * и молча потерял новые значения.
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
    /** `false` — вызов проигнорирован, запись уже идёт. Ошибку запроса пробрасывает. */
    async save(items: CorrectionItem[]): Promise<boolean> {
      if (busy) return false;
      busy = true;
      const key = JSON.stringify(items);
      const ref = unanswered?.key === key ? unanswered.ref : newRef();
      unanswered = null;
      try {
        await opts.send(items, ref);
      } catch (e) {
        if (!(e instanceof ApiError && REJECTED.has(e.code))) unanswered = { key, ref };
        throw e;
      } finally {
        busy = false;
      }
      return true;
    },
  };
}
