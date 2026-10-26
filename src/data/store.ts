import type { Snapshot } from './api';

export interface Store {
  subscribe(cb: (s: Snapshot) => void): () => void;
  start(): void;
  stop(): void;
  current(): Snapshot | null;
  /** Прочитать снимок сейчас, не дожидаясь опроса (после записи): идущий запрос мог выйти раньше записи, поэтому читает заново. */
  refresh(): Promise<void>;
}

const POLL_MS = 15_000;

/**
 * Хранит последний снимок и опрашивает бэкенд. Первая загрузка идёт при старте всегда,
 * дальнейшие опросы — только пока вкладка видна. Ошибки сети молча пропускаются: остаётся последний снимок.
 */
export function createStore(opts: {
  fetchSnapshot: (since?: number) => Promise<Snapshot | 'unchanged'>;
  pollMs?: number;
  visible?: () => boolean;
}): Store {
  const pollMs = opts.pollMs ?? POLL_MS;
  const visible = opts.visible ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const subscribers = new Set<(s: Snapshot) => void>();
  let snapshot: Snapshot | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inflight: Promise<void> | null = null;

  async function fetchOnce(): Promise<void> {
    try {
      const next = await opts.fetchSnapshot(snapshot?.version);
      if (next !== 'unchanged' && next.version !== snapshot?.version) {
        snapshot = next;
        for (const cb of subscribers) {
          try {
            cb(next);
          } catch (e) {
            console.error(e);
          }
        }
      }
    } catch {
      // нет связи: остаётся последний снимок, следующий тик повторит запрос
    }
  }

  function load(): Promise<void> {
    inflight ??= fetchOnce().finally(() => { inflight = null; });
    return inflight;
  }

  return {
    subscribe(cb) {
      subscribers.add(cb);
      return () => { subscribers.delete(cb); };
    },
    start() {
      if (timer !== null) return;
      void load();
      timer = setInterval(() => { if (visible()) void load(); }, pollMs);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    current: () => snapshot,
    async refresh() {
      if (inflight) await inflight;
      await load();
    },
  };
}
