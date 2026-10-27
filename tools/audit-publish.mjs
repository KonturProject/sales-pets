// Проверка перед публикацией репозитория: в отслеживаемых файлах, во ВСЕЙ истории git и в dist/ нет секретов,
// xlsx и реальных фамилий. Вывод — только счётчики и пути: ни найденный секрет, ни фамилия не печатаются.
// Фамилии берутся из локальных xlsx (они в .gitignore): все *.xlsx в корне и пути из аргументов.
// Запуск: npm run audit:publish [путь-к-xlsx ...]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, sep } from 'node:path';
import { createServer } from 'vite';

const MAX_BYTES = 2 * 1024 * 1024;
const SIZE_EXEMPT = ['graphify-out/'];
const FORBIDDEN_EXT = /\.(xlsx?|zip|pem|key|p12|pfx)$/i;
// Самые частые фамилии: в тестах и мок-данных ими названы вымышленные люди, поэтому совпадение с ними не утечка.
const COMMON_SURNAMES = new Set(
  ('иванов петров сидоров смирнов кузнецов попов соколов лебедев козлов новиков морозов волков соловьев васильев зайцев павлов семенов ' +
    'голубев виноградов богданов воробьев федоров михайлов беляев тарасов белов комаров орлов киселев макаров андреев ковалев').split(' '),
);
const MOCK_PIN = '1234'; // админ-PIN мока: он известен и описан в README, это не секрет; тестовые TEST_/MOCK_ константы тоже

const SECRET_PATTERNS = [
  { id: 'github-token', re: 'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}' },
  { id: 'google-api-key', re: 'AIza[0-9A-Za-z_-]{30,}' },
  { id: 'private-key', re: '-----BEGIN [A-Z ]*PRIVATE KEY-----' },
  { id: 'api-key', re: 'sk-[A-Za-z0-9]{20,}' },
  { id: 'pin-assignment', re: '((TEST|MOCK)_)?(INITIAL|ADMIN)_PIN[\'"]?[[:space:]]*[:=][[:space:]]*[\'"]?[0-9]{4,12}', skip: (m) => /^(TEST|MOCK)_/.test(m) || m.endsWith(MOCK_PIN) },
  { id: 'apps-script-url', re: 'script\\.google\\.com/macros/s/[A-Za-z0-9_-]+/exec' },
];

const git = (...args) => execFileSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
/** `git grep` выходит с кодом 1, когда совпадений нет. */
function gitGrep(args) {
  try {
    return git('grep', ...args).split('\n').filter(Boolean);
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
}

const findings = [];
const note = (kind, detail) => findings.push(`${kind}: ${detail}`);

const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
const revs = git('rev-list', '--all').split('\n').filter(Boolean);
console.log(`отслеживаемых файлов: ${tracked.length}, коммитов в истории: ${revs.length}`);

// (а) запрещённые файлы в дереве и когда-либо добавленные в историю, крупные файлы в дереве
for (const f of tracked) {
  const base = f.split('/').pop();
  if (FORBIDDEN_EXT.test(f) || base.startsWith('.env')) note('запрещённый файл в дереве', f);
  if (!SIZE_EXEMPT.some((p) => f.startsWith(p)) && existsSync(f) && statSync(f).size > MAX_BYTES) note('файл крупнее 2 МБ', f);
}
const everAdded = new Set(git('log', '--all', '--name-only', '--format=').split('\n').filter(Boolean));
for (const f of everAdded) if (FORBIDDEN_EXT.test(f) || f.split('/').pop().startsWith('.env')) note('запрещённый файл в истории', f);

// (б) шаблоны секретов: рабочее дерево + вся история
for (const { id, re, skip } of SECRET_PATTERNS) {
  const hits = new Set();
  for (const scope of [['--untracked'], revs]) {
    for (const line of gitGrep(['-I', '-o', '-n', '-E', '-e', re, ...scope, '--'])) {
      // «rev:путь:строка:совпадение» или «путь:строка:совпадение»; совпадение не печатаем
      const m = line.match(/^(?:[0-9a-f]{40}:)?(.+?):\d+:(.*)$/);
      if (!m || (skip && skip(m[2]))) continue;
      hits.add(m[1]);
    }
  }
  if (hits.size) note(`секрет «${id}»`, `${hits.size} файл(ов): ${[...hits].slice(0, 5).join(', ')}`);
}

// (в) реальные фамилии из локальных xlsx и слова из их имён файлов (в имени отчёта бывает фамилия его владельца)
const GENERIC_WORDS = new Set(['копия', 'воронка', 'воронки', 'детальные', 'данные', 'оплаченным', 'счетам', 'дни', 'отчет']);
const norm = (s) => s.toLowerCase().replaceAll('ё', 'е');
const xlsx = [...new Set([...readdirSync('.').filter((f) => /\.xlsx$/i.test(f)), ...process.argv.slice(2)])];
const surnames = new Set(); // нормализованные фамилии и слова из имён файлов
const common = new Set(); // самые частые фамилии: ищем только полные пары «Фамилия Имя»
const phrases = new Set();
if (xlsx.length) {
  const server = await createServer({ logLevel: 'error', appType: 'custom', server: { middlewareMode: true } });
  try {
    const { parseFunnelXlsx } = await server.ssrLoadModule('/src/import/funnel.ts');
    const { parsePaymentsXlsx } = await server.ssrLoadModule('/src/import/payments.ts');
    for (const file of xlsx) {
      for (const w of basename(file, extname(file)).split(/[^\p{L}]+/u)) {
        if (w.length < 4 || GENERIC_WORDS.has(norm(w))) continue;
        surnames.add(norm(w));
        if (norm(w).endsWith('а')) surnames.add(norm(w).slice(0, -1)); // «Иванова» в имени файла — ищем и «Иванов»
      }
      const bytes = readFileSync(file);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const names = [];
      try { names.push(...parseFunnelXlsx(buf).employees.map((e) => e.name)); } catch { /* не воронка */ }
      try { names.push(...parsePaymentsXlsx(buf).rows.map((r) => r.author)); } catch { /* не оплаты */ }
      for (const n of names) {
        const parts = String(n).trim().split(/\s+/).map(norm);
        if (!parts[0] || parts[0].length < 4) continue;
        if (COMMON_SURNAMES.has(parts[0].replace(/а$/, ''))) {
          common.add(parts[0]);
          if (parts[1]) { phrases.add(parts[0] + ' ' + parts[1]); phrases.add(parts[1] + ' ' + parts[0]); }
        } else surnames.add(parts[0]);
      }
    }
  } finally {
    await server.close();
  }
}
console.log('xlsx для сверки: ' + xlsx.length + ', фамилий и слов из имён файлов: ' + surnames.size + ' (самых частых фамилий: ' + common.size + ', ищем только полные пары, пар: ' + phrases.size + ')');

/** Написания для побайтового поиска: все сочетания е/ё и три регистра (строчные, Каждое Слово, ПРОПИСНЫЕ). */
function forms(text) {
  const spots = [...text].flatMap((c, i) => (c === 'е' ? [i] : []));
  const bases = new Set([text]);
  if (spots.length <= 4) {
    for (let mask = 1; mask < 1 << spots.length; mask++) {
      const chars = [...text];
      spots.forEach((p, k) => { if (mask & (1 << k)) chars[p] = 'ё'; });
      bases.add(chars.join(''));
    }
  } else bases.add(text.replaceAll('е', 'ё'));
  const out = new Set();
  for (const b of bases) {
    out.add(b);
    out.add(b.toUpperCase());
    out.add(b.replace(/(^|\s)(\p{L})/gu, (_, sp, ch) => sp + ch.toUpperCase()));
  }
  return out;
}

const needles = [...surnames, ...phrases];
if (needles.length) {
  const variants = new Set(needles.flatMap((n) => [...forms(n)]));
  const hasName = (text) => { const t = norm(text); return needles.some((n) => t.includes(n)); };
  const dir = mkdtempSync(join(tmpdir(), 'audit-'));
  try {
    const patterns = join(dir, 'names.txt');
    writeFileSync(patterns, [...variants].join('\n') + '\n');
    const hits = new Set();
    for (const scope of [['--untracked'], revs]) {
      for (const line of gitGrep(['-I', '-l', '-F', '-f', patterns, ...scope, '--'])) hits.add(line.replace(/^[0-9a-f]{40}:/, ''));
    }
    // имена файлов: в дереве и когда-либо бывшие в истории
    for (const f of [...tracked, ...everAdded]) if (hasName(f)) hits.add('(имя файла) ' + f);
    // dist/ в .gitignore и в git grep не попадает: читаем напрямую
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    if (existsSync('dist')) {
      for (const f of walk('dist').filter((p) => /\.(html|js|css|json|svg|txt)$/.test(p))) {
        if (hasName(readFileSync(f, 'utf8'))) hits.add(f.split(sep).join('/'));
      }
    }
    if (hits.size) note('реальные фамилии', hits.size + ' файл(ов): ' + [...hits].slice(0, 8).join(', '));
    if (hits.size && process.env.AUDIT_EXPLAIN) {
      // диагностика: строки с совпадением, фамилия заменена на «■■■»
      const mask = (line) => [...variants].sort((a, b) => b.length - a.length).reduce((l, v) => l.replaceAll(v, '■■■'), line);
      for (const f of hits) {
        if (!tracked.includes(f)) continue;
        for (const line of gitGrep(['-I', '-n', '-F', '-f', patterns, '--', f])) console.log(mask(line).slice(0, 160));
      }
    }

    // (г) сообщения коммитов и имена авторов: уходят наружу вместе с историей, git grep их не видит
    const jsSecrets = SECRET_PATTERNS.map((p) => ({ ...p, rx: new RegExp(p.re.replaceAll('[[:space:]]', String.raw`\s`)) }));
    const commits = git('log', '--all', '--format=%h%x00%an <%ae>%x00%B%x1e').split('\x1e').map((c) => c.trim()).filter(Boolean);
    const bad = new Set();
    for (const c of commits) {
      const [sha, author, message] = c.split('\0');
      if (hasName(author + ' ' + message)) bad.add(sha);
      for (const { rx, skip } of jsSecrets) {
        const m = (author + ' ' + message).match(rx);
        if (m && !(skip && skip(m[0]))) bad.add(sha);
      }
    }
    if (bad.size) note('сообщения коммитов', bad.size + ' коммит(ов): ' + [...bad].slice(0, 8).join(', '));
    console.log('сообщений коммитов проверено: ' + commits.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  console.log('предупреждение: фамилий для сверки нет (нет xlsx), проверка (в) и (г) пропущены');
}

if (findings.length) {
  console.error('FAIL (' + findings.length + '):\n- ' + findings.join('\n- '));
  process.exit(1);
}
console.log('OK: аудит публикации — запрещённых файлов, секретов и реальных фамилий нет в дереве, истории, сообщениях коммитов и dist/');
