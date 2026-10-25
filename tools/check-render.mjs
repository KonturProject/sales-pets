// Проверка экрана с питомцами на демо-данных: поднимает vite, открывает ?demo=1 в системном Chrome/Edge
// и сверяет DOM (6 групп, фаза/настроение, кучки, счётчики), консоль и загрузку картинок.
// Запуск: npm run check:render
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!browserPath) throw new Error('Не найден Chrome/Edge: задайте CHROME_PATH');

const EXPECTED = {
  СР1: { phase: 'pet', mood: 'ok' },
  СР2: { phase: 'egg2', mood: 'ok' },
  СР3: { phase: 'pet', mood: 'ok' },
  СР5: { phase: 'pet', mood: 'bored' },
  СР6: { phase: 'pet', mood: 'sick' },
  СР9: { phase: 'egg0', mood: 'ok' },
};

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const server = await createServer({ logLevel: 'error', server: { port: 0 } });
await server.listen();
const { port } = server.httpServer.address();
const browser = await chromium.launch({ executablePath: browserPath });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });

  const read = () => page.$$eval('[data-group]', (els) => els.map((e) => ({
    group: e.dataset.group, phase: e.dataset.phase, mood: e.dataset.mood,
    piles: Number(e.dataset.piles), flies: !!e.querySelector('.flies'),
    medkits: e.querySelector('[data-count="medkits"]')?.textContent?.trim(),
    toys: e.querySelector('[data-count="toys"]')?.textContent?.trim(),
  })));

  await page.goto(`http://localhost:${port}/?demo=1`, { waitUntil: 'networkidle' });
  const groups = await read();
  check(groups.length === 6, `ожидалось 6 [data-group], найдено ${groups.length}`);
  for (const g of groups) {
    const want = EXPECTED[g.group];
    check(!!want, `неизвестная группа ${g.group}`);
    if (!want) continue;
    check(g.phase === want.phase, `${g.group}: phase ${g.phase}, ожидалось ${want.phase}`);
    check(g.mood === want.mood, `${g.group}: mood ${g.mood}, ожидалось ${want.mood}`);
    check(g.flies === g.piles > 0, `${g.group}: мухи ${g.flies} при кучках ${g.piles}`);
    check(g.medkits !== undefined && g.toys !== undefined, `${g.group}: нет счётчиков аптечек/игрушек`);
  }
  check(groups.find((g) => g.group === 'СР6')?.piles === 5, 'СР6: ожидалось 5 кучек');
  const broken = await page.$$eval('img', (imgs) => imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
  check(broken.length === 0, `не загрузились картинки: ${broken.join(', ')}`);

  await page.goto(`http://localhost:${port}/?demo=1&asOf=2026-11-11`, { waitUntil: 'networkidle' });
  const eve = (await read()).find((g) => g.group === 'СР9');
  check(eve?.mood === 'dead', `СР9 накануне: mood ${eve?.mood}, ожидалось dead`);

  failures.push(...problems);
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('OK: 6 групп, состояния, кучки, счётчики, консоль и картинки в порядке');
