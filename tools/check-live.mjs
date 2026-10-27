// Живая проверка выложенного сайта в Chrome: node tools/check-live.mjs <адрес сайта> [--backend]
// Без --backend: страницы открываются, демо рисует шесть групп, консоль и сеть чистые.
// С --backend (адрес уже вшит в сборку): общий экран получает снимок через CORS с github.io, «Нет связи» нет.
// PIN не вводится: входов в систему проверка не делает.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const site = (process.argv[2] ?? '').replace(/\/?$/, '/');
const withBackend = process.argv.includes('--backend');
if (!/^https?:\/\//.test(site)) {
  console.error('Использование: node tools/check-live.mjs <адрес сайта> [--backend]');
  process.exit(2);
}
const browserPath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!browserPath) throw new Error('Не найден Chrome/Edge: задайте CHROME_PATH');

const failures = [];
const browser = await chromium.launch({ executablePath: browserPath });
async function open(name, path, fn) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const fail = (m) => failures.push(`${name}: ${m}`);
  page.on('console', (m) => { if (m.type() === 'error') fail(`console: ${m.text()}`); });
  page.on('pageerror', (e) => fail(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => fail(`request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) fail(`HTTP ${r.status()}: ${r.url()}`); });
  try {
    const response = await page.goto(site + path, { waitUntil: 'networkidle' });
    if (!response?.ok()) fail(`страница ответила ${response?.status()}`);
    await fn(page, fail);
  } catch (e) {
    fail(`прервалось: ${e.message}`);
  } finally {
    await page.close();
  }
}
const groups = (page) => page.$$eval('[data-group]', (els) => els.length);
const broken = (page) => page.$$eval('img', (imgs) => imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
const noindex = (page) => page.$eval('meta[name="robots"]', (m) => m.content).catch(() => '');

try {
  await open('демо', '?demo=1', async (page, fail) => {
    await page.waitForSelector('[data-group]', { timeout: 8_000 }).catch(() => {});
    if ((await groups(page)) !== 6) fail('ожидалось 6 групп');
    const bad = await broken(page);
    if (bad.length) fail(`не загрузились картинки: ${bad.join(', ')}`);
    if (!(await noindex(page)).includes('noindex')) fail('нет noindex');
  });
  await open('админка', 'admin.html', async (page, fail) => {
    if ((await page.locator('form[data-login] input[type="password"]').count()) !== 1) fail('нет формы входа');
    if (!(await noindex(page)).includes('noindex')) fail('нет noindex');
  });
  await open('страница РГ', 'rg.html', async (page, fail) => {
    const options = await page.$$eval('select[data-field="group"] option', (os) => os.map((o) => o.value));
    if (options.length !== 6) fail(`групп в списке ${options.length}, ожидалось 6`);
  });
  // не через вкладку: Chrome сам просит /favicon.ico у текстового документа и получает 404, это не ошибка сайта
  const context = await browser.newContext();
  const robots = await context.request.get(site + 'robots.txt');
  if (!robots.ok() || !(await robots.text()).includes('Disallow: /')) failures.push(`robots.txt: HTTP ${robots.status()} или нет Disallow`);
  await context.close();
  if (withBackend) {
    await open('общий экран с бэкендом', '', async (page, fail) => {
      await page.waitForSelector('[data-group]', { timeout: 15_000 }).catch(() => {});
      if ((await groups(page)) !== 6) fail('снимок с бэкенда не пришёл: нет 6 групп');
      if ((await page.$eval('[role="status"]', (e) => e.hidden).catch(() => null)) !== true) fail('показано «Нет связи»');
    });
  } else {
    await open('без бэкенда', '', async (page, fail) => {
      if (!(await page.evaluate(() => document.body.innerText)).includes('Игра ещё не запущена')) fail('нет сообщения «Игра ещё не запущена»');
    });
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`OK: ${site} — демо, админка, РГ, robots.txt, ${withBackend ? 'живой снимок с бэкенда' : 'сообщение «Игра ещё не запущена»'}`);
