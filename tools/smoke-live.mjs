// Дымовая проверка настоящего бэкенда после развёртывания: node tools/smoke-live.mjs <адрес …/exec>
// Только чтение: один GET снимка, один GET «без изменений» (так опрашивают страницы раз в 15 с) и один POST с неизвестным действием.
// Неизвестное действие отклоняется до проверки PIN, поэтому счётчики блокировки админа и групп не тратятся. Входов в систему нет.
import { pathToFileURL } from 'node:url';

const SLOW_MS = 3_000;
const BIG_BYTES = 1024 * 1024;
const REQUIRED_ARRAYS = ['staff', 'payments', 'funnel', 'overrides', 'configChanges'];
/** Ключи, которых нет в публичном снимке (apps-script/README.md, «Что публично»); сравнение без учёта регистра. */
const FORBIDDEN_KEYS = new Set(['pin', 'grouppin', 'adminpin', 'pinhash', 'hash', 'salt', 'amount', 'sum', 'hiddenreason', 'hiddenreasons', 'ref']);

function forbiddenIn(value, path = '', found = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => forbiddenIn(v, `${path}[]`, found));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) found.add(`${path}.${k}`.replace(/^\./, ''));
      forbiddenIn(v, `${path}.${k}`, found);
    }
  }
  return found;
}

/** Возвращает `{ failures, warnings, info }`; `fetchFn` подменяется в тестах. */
export async function smoke(url, { fetchFn = fetch } = {}) {
  const failures = [];
  const warnings = [];
  const info = [];
  const timed = async (label, request) => {
    const started = performance.now();
    const res = await request();
    const text = await res.text();
    const ms = Math.round(performance.now() - started);
    info.push(`${label}: HTTP ${res.status}, ${ms} мс, ${(text.length / 1024).toFixed(1)} КБ`);
    let json;
    try { json = JSON.parse(text); } catch { failures.push(`${label}: ответ не JSON (начало: ${JSON.stringify(text.slice(0, 80))})`); }
    return { res, json, ms, bytes: text.length };
  };

  try {
    const full = await timed('GET снимок', () => fetchFn(url));
    const s = full.json;
    if (s) {
      if (s.ok !== true) failures.push(`GET снимок: ok = ${s.ok}, error = ${s.error}`);
      for (const key of REQUIRED_ARRAYS) if (!Array.isArray(s[key])) failures.push(`GET снимок: поле ${key} не массив`);
      if (!s.config || typeof s.config !== 'object' || Array.isArray(s.config)) failures.push('GET снимок: поле config не объект');
      if (typeof s.serverNow !== 'string' || Number.isNaN(Date.parse(s.serverNow))) failures.push('GET снимок: нет serverNow');
      const forbidden = [...forbiddenIn(s)];
      if (forbidden.length) failures.push(`GET снимок: в публичном ответе запрещённые ключи: ${forbidden.join(', ')}`);
      info.push(`сотрудников ${s.staff?.length ?? '?'}, оплат ${s.payments?.length ?? '?'}, строк воронки ${s.funnel?.length ?? '?'}, версия ${s.version}`);
      if (full.ms > SLOW_MS) warnings.push(`снимок отвечает дольше ${SLOW_MS} мс: нужен кэш частями (apps-script/README.md, «Скорость»)`);
      if (full.bytes > BIG_BYTES) warnings.push(`снимок крупнее ${BIG_BYTES / 1024} КБ`);
      const cors = full.res.headers?.get?.('access-control-allow-origin');
      if (!cors) warnings.push('в ответе нет Access-Control-Allow-Origin: страница с github.io может не прочитать снимок (решает проверка в браузере)');

      const next = await timed('GET без изменений', () => fetchFn(`${url}${url.includes('?') ? '&' : '?'}since=${encodeURIComponent(s.version)}`));
      if (next.json && !(next.json.ok === true && next.json.unchanged === true)) failures.push(`GET без изменений: ожидалось ok и unchanged, пришло ${JSON.stringify(next.json).slice(0, 120)}`);
      if (next.ms > SLOW_MS) warnings.push(`опрос «без изменений» дольше ${SLOW_MS} мс`);
    }

    const post = await timed('POST неизвестное действие', () => fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: '__smoke__' }),
    }));
    if (post.json && !(post.json.ok === false && post.json.error === 'bad_request')) failures.push(`POST: ожидалось bad_request, пришло ${JSON.stringify(post.json).slice(0, 120)}`);
  } catch (e) {
    failures.push(`сеть: ${e.message}`);
  }
  return { failures, warnings, info };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2];
  if (!url || !/^https?:\/\//.test(url)) {
    console.error('Использование: node tools/smoke-live.mjs <адрес …/exec>');
    process.exit(2);
  }
  const { failures, warnings, info } = await smoke(url);
  for (const line of info) console.log(line);
  for (const line of warnings) console.warn(`ВНИМАНИЕ: ${line}`);
  if (failures.length) {
    console.error(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('OK: бэкенд отвечает, публичный снимок без запрещённых ключей, неизвестное действие отклонено');
}
