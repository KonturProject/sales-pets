import { ApiError } from '@/data/api';

export type Item = 'medkit' | 'toy';

/**
 * Расход РГ (предмет, покупка `buy:<код>`, отпуск). Пока запрос идёт, новый клик игнорируется. Если ответа не было
 * (обрыв связи, таймаут), запрос мог дойти до сервера: следующий клик по тому же ключу несёт тот же `ref`, сервер узнаёт
 * повтор и не спишет второй раз (R14). Любой ответ сервера, и успех, и отказ, закрывает попытку.
 */
export function createSpender<K extends string = Item>(opts: {
  send: (key: K, ref: string) => Promise<unknown>;
  newRef?: () => string;
}) {
  const newRef = opts.newRef ?? (() => crypto.randomUUID());
  const unanswered = new Map<K, string>();
  let busy = false;

  return {
    get busy(): boolean {
      return busy;
    },
    /** `false` — клик проигнорирован, запрос уже идёт. Ошибку запроса пробрасывает. */
    async spend(key: K): Promise<boolean> {
      if (busy) return false;
      busy = true;
      const ref = unanswered.get(key) ?? newRef();
      unanswered.delete(key);
      try {
        await opts.send(key, ref);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'network') unanswered.set(key, ref);
        throw e;
      } finally {
        busy = false;
      }
      return true;
    },
  };
}
