import { ApiError } from '@/data/api';

export type Item = 'medkit' | 'toy';

/**
 * Расход предмета РГ. Пока запрос идёт, новый клик игнорируется. Если ответа не было (обрыв связи, таймаут),
 * запрос мог дойти до сервера: следующий клик по тому же предмету несёт тот же `ref`, сервер узнаёт повтор
 * и не спишет второй раз (R14). Любой ответ сервера, и успех, и отказ, закрывает попытку.
 */
export function createSpender(opts: {
  send: (item: Item, ref: string) => Promise<unknown>;
  newRef?: () => string;
}) {
  const newRef = opts.newRef ?? (() => crypto.randomUUID());
  const unanswered = new Map<Item, string>();
  let busy = false;

  return {
    get busy(): boolean {
      return busy;
    },
    /** `false` — клик проигнорирован, запрос уже идёт. Ошибку запроса пробрасывает. */
    async spend(item: Item): Promise<boolean> {
      if (busy) return false;
      busy = true;
      const ref = unanswered.get(item) ?? newRef();
      unanswered.delete(item);
      try {
        await opts.send(item, ref);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'network') unanswered.set(item, ref);
        throw e;
      } finally {
        busy = false;
      }
      return true;
    },
  };
}
