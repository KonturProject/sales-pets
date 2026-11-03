/** Раз в сколько страница сверяет номер сборки. */
const CHECK_MS = 300_000;
/** Одна сборка — не чаще одной перезагрузки за это время: защита, если страница снова открылась со старой копией из кэша. */
const RELOAD_COOLDOWN_MS = 15 * 60_000;
const STORAGE_KEY = 'petsReloadedFor';

export interface LastReload {
  build: string;
  at: number;
}

/** Нужна ли перезагрузка: на сервере другая сборка, и на неё страница ещё не перезагружалась последние 15 минут. */
export function decideReload(current: string, fetched: string | null, lastReload: LastReload | null, now: number): boolean {
  if (fetched === null || fetched === current) return false;
  return !(lastReload && lastReload.build === fetched && now - lastReload.at < RELOAD_COOLDOWN_MS);
}

/** Номер сборки с сервера; `null` — файла нет, ответ не разобран или в нём нет номера. */
async function fetchBuild(): Promise<string | null> {
  const url = new URL('version.json', location.href);
  url.searchParams.set('t', String(Date.now())); // GitHub Pages кэширует файлы на 10 минут
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return null;
  const data: unknown = await response.json().catch(() => null);
  const build = (data as { build?: unknown } | null)?.build;
  return typeof build === 'string' ? build : null;
}

/**
 * Раз в несколько минут читает `version.json` и зовёт `onNew`, пока на сервере сборка не та, что вшита в страницу.
 * В dev ничего не делает. Ошибки сети молча пропускаются: следующий тик повторит. Возвращает функцию остановки.
 */
export function watchBuild(onNew: (build: string) => void, everyMs = CHECK_MS): () => void {
  if (import.meta.env.DEV) return () => {};
  const timer = setInterval(async () => {
    const build = await fetchBuild().catch(() => null);
    if (build !== null && build !== __BUILD_ID__) onNew(build);
  }, everyMs);
  return () => clearInterval(timer);
}

let reloading = false; // если sessionStorage недоступен: хотя бы не перезагружать одну и ту же страницу дважды

function readLastReload(): LastReload | null {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    const { build, at } = (saved ?? {}) as Partial<LastReload>;
    return typeof build === 'string' && typeof at === 'number' ? { build, at } : null;
  } catch {
    return null;
  }
}

/** Перезагрузить страницу на сборку `fetched`, если `decideReload` разрешает. В sessionStorage уходит только номер сборки и время. */
export function reloadForBuild(fetched: string, now = Date.now()): void {
  if (reloading || !decideReload(__BUILD_ID__, fetched, readLastReload(), now)) return;
  reloading = true;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ build: fetched, at: now }));
  } catch {
    // хранилище закрыто: перезагрузка всё равно нужна, защита остаётся только в памяти
  }
  location.reload();
}
