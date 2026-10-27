// Проверка перед публикацией репозитория: в отслеживаемых файлах, во ВСЕЙ истории git и в dist/ нет секретов,
// xlsx и реальных фамилий. Вывод — только счётчики и пути: ни найденный секрет, ни фамилия не печатаются.
// Фамилии берутся из локальных xlsx (они в .gitignore): все *.xlsx в корне и пути из аргументов.
// Запуск: npm run audit:publish [путь-к-xlsx ...]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// (в) реальные фамилии из локальных xlsx
const xlsx = [...new Set([...readdirSync('.').filter((f) => /\.xlsx$/i.test(f)), ...process.argv.slice(2)])];
const surnames = new Set();
const common = new Set();
if (xlsx.length) {
  const server = await createServer({ logLevel: 'error', appType: 'custom', server: { middlewareMode: true } });
  try {
    const { parseFunnelXlsx } = await server.ssrLoadModule('/src/import/funnel.ts');
    const { parsePaymentsXlsx } = await server.ssrLoadModule('/src/import/payments.ts');
    for (const file of xlsx) {
      const bytes = readFileSync(file);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const names = [];
      try { names.push(...parseFunnelXlsx(buf).employees.map((e) => e.name)); } catch { /* не воронка */ }
      try { names.push(...parsePaymentsXlsx(buf).rows.map((r) => r.author)); } catch { /* не оплаты */ }
      for (const n of names) {
        const surname = String(n).trim().split(/\s+/)[0];
        if (!surname || surname.length < 4) continue;
        const lower = surname.toLowerCase();
        if (COMMON_SURNAMES.has(lower.replaceAll('ё', 'е').replace(/а$/, ''))) common.add(lower);
        else surnames.add(lower);
      }
    }
  } finally {
    await server.close();
  }
}
console.log(`xlsx для сверки фамилий: ${xlsx.length}, уникальных фамилий: ${surnames.size} (самых частых, пропущено: ${common.size})`);

if (surnames.size) {
  const variants = new Set();
  for (const s of surnames) {
    for (const v of new Set([s, s.replaceAll('ё', 'е'), s.replaceAll('е', 'ё')])) {
      variants.add(v);
      variants.add(v[0].toUpperCase() + v.slice(1));
      variants.add(v.toUpperCase());
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'audit-'));
  try {
    const patterns = join(dir, 'names.txt');
    writeFileSync(patterns, [...variants].join('\n') + '\n');
    const hits = new Set();
    for (const scope of [['--untracked'], revs]) {
      for (const line of gitGrep(['-I', '-l', '-F', '-f', patterns, ...scope, '--'])) hits.add(line.replace(/^[0-9a-f]{40}:/, ''));
    }
    // dist/ в .gitignore и в git grep не попадает: читаем напрямую
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    if (existsSync('dist')) {
      for (const f of walk('dist').filter((p) => /\.(html|js|css|json|svg|txt)$/.test(p))) {
        const body = readFileSync(f, 'utf8');
        if ([...variants].some((v) => body.includes(v))) hits.add(f.replaceAll('\\', '/'));
      }
    }
    if (hits.size) note('реальные фамилии', `${hits.size} файл(ов): ${[...hits].slice(0, 8).join(', ')}`);
    if (hits.size && process.env.AUDIT_EXPLAIN) {
      // диагностика: строки с совпадением, фамилия заменена на «■■■»
      const mask = (line) => [...variants].sort((a, b) => b.length - a.length).reduce((l, v) => l.replaceAll(v, '■■■'), line);
      for (const f of hits) {
        if (!tracked.includes(f)) continue;
        for (const line of gitGrep(['-I', '-n', '-F', '-f', patterns, '--', f])) console.log(mask(line).slice(0, 160));
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  console.log('предупреждение: фамилий для сверки нет (нет xlsx), проверка (в) пропущена');
}

if (findings.length) {
  console.error(`FAIL (${findings.length}):\n- ${findings.join('\n- ')}`);
  process.exit(1);
}
console.log('OK: аудит публикации — запрещённых файлов, секретов и реальных фамилий нет в дереве, истории и dist/');
