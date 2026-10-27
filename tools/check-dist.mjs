// Проверка собранного сайта так, как его увидят на GitHub Pages: продакшен-сборка (не dev-сервер Vite) лежит под
// подпутём /sales-pets/ и открывается с хоста, который не localhost. Бэкенд — мок, исполняющий настоящий Code.gs.
// Две сборки: с вшитым адресом бэкенда (VITE_BACKEND_URL) и без него. PIN в вывод не попадает. Запуск: npm run check:dist
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { MOCK_ADMIN_PIN, startMockBackend } from './mock-backend.mjs';

const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!browserPath) throw new Error('Не найден Chrome/Edge: задайте CHROME_PATH');

const root = fileURLToPath(new URL('..', import.meta.url));
const PREFIX = '/sales-pets/';
/** Chrome считает *.localhost безопасным контекстом (как https на github.io) и сам ведёт его на loopback; от `localhost` хост отличается, как и github.io. */
const SITE_HOST = 'pets.localhost';
const GROUP_CODES = ['СР1', 'СР2', 'СР3', 'СР5', 'СР6', 'СР9'];
const EVIL = 'https://evil.example/exec';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
};
const failures = [];

/** Продакшен-сборка в `outDir`; `backend` пустой — переменная не задана совсем. */
function build(outDir, backend) {
  const env = { ...process.env };
  delete env.VITE_BACKEND_URL;
  delete env.NODE_ENV; // createServer из Vite выше выставил development, а сборка в CI стартует без NODE_ENV
  if (backend) env.VITE_BACKEND_URL = backend;
  const r = spawnSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`vite build упал:\n${(r.stdout + r.stderr).slice(-1500)}`);
}

/** Как GitHub Pages: файлы только под префиксом, всё остальное 404 (абсолютный путь `/assets/…` в сборке не спрячется). */
function serve(dir) {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (!pathname.startsWith(PREFIX)) return void res.writeHead(404).end();
    const rel = decodeURIComponent(pathname.slice(PREFIX.length)) || 'index.html';
    const file = resolve(dir, rel.endsWith('/') ? `${rel}index.html` : rel);
    if (!file.startsWith(resolve(dir) + sep) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    origin: `http://${SITE_HOST}:${server.address().port}${PREFIX}`,
    close: () => new Promise((done) => server.close(done)),
  })));
}

const work = mkdtempSync(join(tmpdir(), 'check-dist-'));
const withBackend = join(work, 'with-backend');
const withoutBackend = join(work, 'without-backend');
const mock = await startMockBackend({ port: 0 });
const mockHost = new URL(mock.url).host;

const vite = await createServer({ logLevel: 'error', appType: 'custom', server: { middlewareMode: true } });
const fx = await vite.ssrLoadModule('/src/import/fixtures.ts');
await vite.close();

build(withBackend, mock.url);
build(withoutBackend, '');
const site = await serve(withBackend);
const bare = await serve(withoutBackend);
const browser = await chromium.launch({ executablePath: browserPath });

/** Страница с наблюдением: любые ошибки консоли/страницы/сети и запросы на чужие хосты — провал. Запросы копятся в `requests`. */
async function open(name, context) {
  const page = await context.newPage();
  const requests = [];
  const fail = (message) => failures.push(`${name}: ${message}`);
  page.on('console', (m) => { if (m.type() === 'error') fail(`console: ${m.text()}`); });
  page.on('pageerror', (e) => fail(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => fail(`request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) fail(`HTTP ${r.status()}: ${r.url()}`); });
  page.on('request', (r) => {
    requests.push(r.url());
    const url = new URL(r.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.host !== mockHost && url.hostname !== SITE_HOST) fail(`запрос на чужой хост: ${url.host}`);
  });
  return { page, requests, fail, check: (ok, message) => { if (!ok) fail(message); } };
}

const groupsOf = (page) => page.$$eval('[data-group]', (els) => els.map((e) => ({ group: e.dataset.group, phase: e.dataset.phase })));
const brokenImages = (page) => page.$$eval('img', (imgs) => imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
const waitGroups = (page) => page.waitForSelector('[data-group]', { timeout: 8_000 }).catch(() => {});
const mockGets = (requests) => requests.filter((u) => u.startsWith(mock.url)).length;
/** Адрес evil.example сидит и в самой ссылке страницы (?backend=…), поэтому смотрим на хост запроса, а не на подстроку. */
const toEvil = (requests) => requests.some((u) => new URL(u).hostname === new URL(EVIL).hostname);

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  {
    const { page, check } = await open('общий экран', context);
    await page.goto(`${site.origin}?asOf=2026-11-12`, { waitUntil: 'networkidle' });
    await waitGroups(page);
    const groups = await groupsOf(page);
    check(groups.length === 6, `ожидалось 6 [data-group], найдено ${groups.length}`);
    check(await page.evaluate(() => window.isSecureContext), 'страница не в безопасном контексте: проверка не похожа на https');
    const broken = await brokenImages(page);
    check(broken.length === 0, `не загрузились картинки: ${broken.join(', ')}`);
    check((await page.$eval('[role="status"]', (e) => e.hidden).catch(() => null)) === true, 'нет скрытого [role="status"] или показано «Нет связи»');
    const rows = await page.$$eval('[data-block="group"] tbody tr[data-employee]', (trs) => trs.length).catch(() => 0);
    check(rows >= 1, 'панель рейтинга «Группа» пуста');
    await page.close();
  }

  {
    // сегодня (до старта игры) все яйца; дата задана явно, чтобы проверка не зависела от календаря
    const { page, check } = await open('до старта', context);
    await page.goto(`${site.origin}?asOf=2026-10-28`, { waitUntil: 'networkidle' });
    await waitGroups(page);
    const groups = await groupsOf(page);
    check(groups.length === 6, `ожидалось 6 [data-group], найдено ${groups.length}`);
    check(groups.every((g) => g.phase?.startsWith('egg')), `до старта не все яйца: ${JSON.stringify(groups.map((g) => g.phase))}`);
    await page.close();
  }

  {
    const { page, requests, check } = await open('админка', context);
    await page.goto(`${site.origin}admin.html`, { waitUntil: 'networkidle' });
    await page.fill('form[data-login] input[type="password"]', MOCK_ADMIN_PIN);
    await page.click('form[data-login] button[type="submit"]');
    await page.waitForSelector('[role="tab"][data-tab="import"]', { timeout: 8_000 }).catch(() => {});
    check(await page.locator('[role="tab"]').count() >= 5, 'после входа нет вкладок админки');
    check(!requests.some((u) => /\/assets\/xlsx-/.test(u)), 'чанк xlsx загружен до выбора файла');
    // чанк xlsx подгружается динамическим import() по относительному пути: выбор файла должен его получить
    await page.click('[role="tab"][data-tab="import"]');
    const chunk = page.waitForResponse((r) => /\/assets\/xlsx-.*\.js$/.test(r.url()), { timeout: 8_000 }).catch(() => null);
    const file = { name: 'pay.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(fx.paymentsXlsx([
      { date: '2026-11-11', group: 'СР1', author: 'Тест Один', invoice: 'DIST-1' },
      { date: '2026-11-11', group: 'СР1', author: 'Тест Один', invoice: 'DIST-2' },
    ])) };
    await page.setInputFiles('[data-file="payments"]', file);
    const response = await chunk;
    check(response?.status() === 200 && response.url().includes(`${PREFIX}assets/`), `чанк xlsx не получен под ${PREFIX}`);
    await page.waitForFunction(() => document.querySelector('[data-report="payments"]')?.textContent?.includes('Оплат к загрузке: 2'), null, { timeout: 8_000 }).catch(() => {});
    check((await page.$eval('[data-report="payments"]', (e) => e.textContent ?? '').catch(() => '')).includes('Оплат к загрузке: 2'), 'превью оплат не появилось после выбора файла');
    await page.click('[role="tab"][data-tab="norms"]');
    check(await page.waitForSelector('[data-field="norm-experienced-quality"]', { timeout: 8_000 }).then(() => true, () => false), 'вкладка «Нормы и пороги» не отрисована');
    await page.close();
  }

  {
    const { page, check } = await open('страница РГ', context);
    await page.goto(`${site.origin}rg.html`, { waitUntil: 'networkidle' });
    check(await page.locator('form[data-login]').count() === 1, 'нет формы входа');
    const options = await page.$$eval('select[data-field="group"] option', (os) => os.map((o) => o.value));
    check(JSON.stringify(options) === JSON.stringify(GROUP_CODES), `группы в списке: ${JSON.stringify(options)}`);
    await page.close();
  }

  {
    // ?backend= не уводит боевую сборку на чужой адрес (иначе по ссылке ушёл бы PIN), ?pollMs= не ускоряет опрос на чужом хосте
    const screen = await open('чужой backend на экране', context);
    await screen.page.goto(`${site.origin}?asOf=2026-11-12&backend=${encodeURIComponent(EVIL)}&pollMs=500`, { waitUntil: 'networkidle' });
    await waitGroups(screen.page);
    await screen.page.waitForTimeout(2_500);
    screen.check((await groupsOf(screen.page)).length === 6, 'с чужим ?backend= питомцы не пришли с вшитого адреса');
    screen.check(!toEvil(screen.requests), 'запрос ушёл на evil.example');
    screen.check(mockGets(screen.requests) <= 2, `?pollMs= ускорил опрос на чужом хосте: запросов к бэкенду ${mockGets(screen.requests)} за 2,5 с`);
    await screen.page.close();

    const admin = await open('чужой backend в админке', context);
    await admin.page.goto(`${site.origin}admin.html?backend=${encodeURIComponent(EVIL)}`, { waitUntil: 'networkidle' });
    await admin.page.fill('form[data-login] input[type="password"]', MOCK_ADMIN_PIN);
    await admin.page.click('form[data-login] button[type="submit"]');
    await admin.page.waitForSelector('[role="tab"][data-tab="import"]', { timeout: 8_000 }).catch(() => {});
    admin.check(await admin.page.locator('[role="tab"]').count() >= 5, 'вход в админку с чужим ?backend= не дошёл до вкладок');
    admin.check(!toEvil(admin.requests), 'PIN ушёл бы на evil.example');
    await admin.page.close();
  }

  {
    // сборка без адреса бэкенда: понятное сообщение, а не белый экран; демонстрация работает
    const noBackend = await open('без бэкенда', context);
    await noBackend.page.goto(bare.origin, { waitUntil: 'networkidle' });
    noBackend.check((await noBackend.page.evaluate(() => document.body.innerText)).includes('Игра ещё не запущена'), 'нет сообщения «Игра ещё не запущена»');
    await noBackend.page.goto(`${bare.origin}?demo=1`, { waitUntil: 'networkidle' });
    await waitGroups(noBackend.page);
    noBackend.check((await groupsOf(noBackend.page)).length === 6, '?demo=1: ожидалось 6 групп');
    const broken = await brokenImages(noBackend.page);
    noBackend.check(broken.length === 0, `?demo=1: не загрузились картинки: ${broken.join(', ')}`);
    await noBackend.page.close();
  }

  await context.close();
} catch (e) {
  failures.push(`проверка прервалась: ${e.message}`);
} finally {
  await browser.close();
  await site.close();
  await bare.close();
  await mock.close();
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('OK: собранный сайт под /sales-pets/ — экран, до старта, админка (чанк xlsx), РГ, чужой ?backend=, сборка без бэкенда');
