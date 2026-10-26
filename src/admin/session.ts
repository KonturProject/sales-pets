import { ApiError } from '@/data/api';

export type Post = <T>(action: string, body: object) => Promise<T>;

export interface Session {
  /** Проверяет PIN действием `login`; запоминает его только если сервер принял. */
  login(pin: string): Promise<void>;
  /** Админ-действие: PIN сессии подставляется в тело, чужой `pin` из `body` его не заменит. */
  call<T = Record<string, unknown>>(action: string, body?: object): Promise<T>;
  logout(): void;
}

/**
 * PIN администратора живёт только в этом замыкании: ни в DOM, ни в хранилище, ни в консоли.
 * Если сервер посреди работы отказал по PIN (сменили, блокировка), PIN забывается и вызывается `onLogout`.
 */
export function createSession(post: Post, onLogout: () => void): Session {
  let pin: string | null = null;

  return {
    async login(candidate) {
      await post('login', { pin: candidate });
      pin = candidate;
    },
    async call<T>(action: string, body: object = {}): Promise<T> {
      if (pin === null) throw new ApiError('invalid_pin', 'invalid_pin');
      try {
        return await post<T>(action, { ...body, pin });
      } catch (e) {
        if (e instanceof ApiError && (e.code === 'invalid_pin' || e.code === 'locked') && pin !== null) {
          pin = null;
          onLogout();
        }
        throw e;
      }
    },
    logout() {
      pin = null;
    },
  };
}
