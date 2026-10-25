import type { FunnelDay } from '@/engine/evaluate';
import type { Absence, Employee } from '@/engine/staff';
import type { DateStr, GroupCode } from '@/engine/types';
import type { ImportedPayment } from '@/import/payments';

/** Публичный снимок фактов, который отдаёт бэкенд (без сумм, хешей и PIN). */
export interface Snapshot {
  version: number;
  serverNow: string;
  funnelThrough: DateStr | null;
  paymentsImportedThrough: DateStr | null;
  config: { dailyNorm?: number };
  staff: Employee[];
  absences: Absence[];
  payments: ImportedPayment[];
  provisional: { date: DateStr; group: GroupCode; count: number }[];
  funnel: FunnelDay[];
}

export type ApiErrorCode = 'invalid_pin' | 'locked' | 'bad_request' | 'server_error' | 'network';

const SERVER_CODES: readonly string[] = ['invalid_pin', 'locked', 'bad_request', 'server_error'];
const TIMEOUT_MS = 10_000;
const NO_CONNECTION = 'Нет связи с сервером';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly retryAfterSec?: number;

  constructor(code: ApiErrorCode, message: string, retryAfterSec?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Адрес бэкенда. `?backend=<url>` подменяет вшитый адрес только в разработке или на локальный хост (R11):
 * иначе ссылка с чужим адресом увела бы PIN администратора на чужой сервер.
 */
export function resolveBackend(search: string, o: { dev: boolean; baked: string }): string {
  const raw = new URLSearchParams(search).get('backend');
  if (!raw) return o.baked;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return o.baked;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return o.baked;
  return o.dev || LOCAL_HOSTS.has(url.hostname) ? raw : o.baked;
}

export function backendUrl(): string {
  return resolveBackend(location.search, { dev: import.meta.env.DEV, baked: String(import.meta.env.VITE_BACKEND_URL ?? '') });
}

export function createApi(o: {
  url: () => string;
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}) {
  const doFetch = o.fetchFn ?? ((url: string, init: RequestInit) => fetch(url, init));
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS;

  /** Один запрос без cookie, с таймаутом; любой сбой доставки — `ApiError('network')`, `ok:false` — ошибка сервера. */
  async function request(makeUrl: (base: string) => string, init: RequestInit): Promise<Record<string, unknown>> {
    const base = o.url();
    if (!base) throw new ApiError('network', NO_CONNECTION);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let body: unknown;
    try {
      const res = await doFetch(makeUrl(base), { ...init, credentials: 'omit', signal: ctl.signal });
      body = res.ok ? await res.json() : undefined;
    } catch {
      body = undefined;
    } finally {
      clearTimeout(timer);
    }
    if (typeof body !== 'object' || body === null) throw new ApiError('network', NO_CONNECTION);
    const reply = body as { ok?: unknown; error?: unknown; retryAfterSec?: unknown };
    if (reply.ok !== true) {
      const code = SERVER_CODES.includes(String(reply.error)) ? (reply.error as ApiErrorCode) : 'server_error';
      const retry = typeof reply.retryAfterSec === 'number' ? reply.retryAfterSec : undefined;
      throw new ApiError(code, code, retry);
    }
    return body as Record<string, unknown>;
  }

  return {
    /** Снимок фактов; `since` — версия, уже имеющаяся у клиента: если она не изменилась, вернётся `'unchanged'`. */
    async get(since?: number): Promise<Snapshot | 'unchanged'> {
      const body = await request((base) => (since === undefined ? base : `${base}?since=${since}`), { method: 'GET' });
      return body.unchanged === true ? 'unchanged' : (body as unknown as Snapshot);
    },
    /** Действие бэкенда; тело — JSON как `text/plain`, чтобы запрос обошёлся без предзапроса CORS. */
    async post<T>(action: string, body: object): Promise<T> {
      const reply = await request((base) => base, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...body, action }),
      });
      return reply as T;
    },
  };
}

export const api = createApi({ url: backendUrl });
