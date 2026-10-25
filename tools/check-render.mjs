// Проверка экрана с питомцами: поднимает vite и мок-бэкенд, открывает системный Chrome/Edge и сверяет DOM.
// Демо (?demo=1) и живой экран на мок-бэкенде (?backend=): 6 групп, фаза/настроение, кучки, счётчики,
// панель рейтингов (места, ФИО, отпускник вне рейтинга), «Нет связи с сервером» при недоступном бэкенде,
// консоль и картинки. Запуск: npm run check:render
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { MOCK_VACATIONER, startMockBackend } from './mock-backend.mjs';

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

/** Рейтинг группы СР1 на 12.11 в моке: сотрудники по числу счетов (СР1-6 в отпуске), СР1-3 и СР1-4 делят 3-е место. */
const SR1_RANKING = [
  { place: 1, name: 'Тест СР1-1', value: 9 },
  { place: 2, name: 'Тест СР1-2', value: 8 },
  { place: 3, name: 'Тест СР1-3', value: 7 },
  { place: 3, name: 'Тест СР1-4', value: 7 },
  { place: 5, name: 'Тест СР1-5', value: 6 },
];

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

function checkStates(groups, label) {
  check(groups.length === 6, `${label}: ожидалось 6 [data-group], найдено ${groups.length}`);
  for (const g of groups) {
    const want = EXPECTED[g.group];
    check(!!want, `${label}: неизвестная группа ${g.group}`);
    if (!want) continue;
    check(g.phase === want.phase, `${label}: ${g.group}: phase ${g.phase}, ожидалось ${want.phase}`);
    check(g.mood === want.mood, `${label}: ${g.group}: mood ${g.mood}, ожидалось ${want.mood}`);
    check(g.flies === g.piles > 0, `${label}: ${g.group}: мухи ${g.flies} при кучках ${g.piles}`);
    check(g.medkits !== undefined && g.toys !== undefined, `${label}: ${g.group}: нет счётчиков аптечек/игрушек`);
  }
  check(groups.find((g) => g.group === 'СР6')?.piles === 5, `${label}: СР6: ожидалось 5 кучек`);
}

const server = await createServer({ logLevel: 'error', server: { port: 0 } });
await server.listen();
const { port } = server.httpServer.address();
const base = `http://localhost:${port}/`;
const mock = await startMockBackend({ port: 0 });
let mockClosed = false;
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
  const brokenImages = () => page.$$eval('img', (imgs) => imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
  // чтение и выбор в панели не бросают при отсутствии элемента: провал попадает в список, а не обрывает проверку
  const valueOf = (selector, pick) => page.$eval(selector, pick).catch(() => null);
  const choose = (selector, value) => page.selectOption(selector, value, { timeout: 2_000 }).catch(() => {});
  const panelRows = (block) => page.$$eval(`[data-block="${block}"] tbody tr[data-employee]`, (trs) => trs.map((tr) => ({
    place: Number(tr.querySelector('.place')?.textContent),
    name: tr.querySelector('.name')?.textContent?.trim(),
    value: parseInt(tr.querySelector('.value')?.textContent ?? '', 10),
  })));

  // --- без параметров игра не запущена
  await page.goto(base, { waitUntil: 'networkidle' });
  check((await page.evaluate(() => document.body.innerText)).includes('Игра ещё не запущена'), 'без параметров: нет сообщения «Игра ещё не запущена»');

  // --- демо
  await page.goto(`${base}?demo=1`, { waitUntil: 'networkidle' });
  checkStates(await read(), 'демо');
  const broken = await brokenImages();
  check(broken.length === 0, `демо: не загрузились картинки: ${broken.join(', ')}`);

  await page.goto(`${base}?demo=1&asOf=2026-11-11`, { waitUntil: 'networkidle' });
  const eve = (await read()).find((g) => g.group === 'СР9');
  check(eve?.mood === 'dead', `СР9 накануне: mood ${eve?.mood}, ожидалось dead`);

  // мусор в ?asOf= не должен вешать вкладку: рисуется дата по умолчанию
  await page.goto(`${base}?demo=1&asOf=today`, { waitUntil: 'networkidle', timeout: 10_000 });
  check((await read()).length === 6, 'asOf=today: ожидалось 6 групп (откат на дату по умолчанию)');

  // --- живой экран на мок-бэкенде
  const live = `${base}?backend=${encodeURIComponent(mock.url)}&asOf=2026-11-12`;
  await page.goto(live, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-group]', { timeout: 8_000 }).catch(() => {});
  checkStates(await read(), 'живой экран');
  const liveBroken = await brokenImages();
  check(liveBroken.length === 0, `живой экран: не загрузились картинки: ${liveBroken.join(', ')}`);
  check(await valueOf('[role="status"]', (e) => e.hidden) === true, 'живой экран: нет скрытого [role="status"] или показано «Нет связи» при рабочем бэкенде');

  // панель рейтингов: места, полные ФИО, отпускник вне рейтингов
  check(JSON.stringify(await panelRows('group')) === JSON.stringify(SR1_RANKING), `панель «Группа»: ${JSON.stringify(await panelRows('group'))}`);
  const top = await panelRows('top');
  check(top.length >= 1 && top.length <= 10, `панель «Топ-10»: строк ${top.length}`);
  check(JSON.stringify(top[0]) === JSON.stringify(SR1_RANKING[0]), `панель «Топ-10»: первая строка ${JSON.stringify(top[0])}`);
  const heroes = await panelRows('heroes');
  check(heroes.length === 10 && heroes[0].place === 1 && heroes[0].value === 100, `панель «Герои дня»: ${JSON.stringify(heroes.slice(0, 2))} (строк ${heroes.length})`);
  check(await valueOf('select[data-pick="day"]', (s) => s.value) === '2026-11-11', 'панель «Герои дня»: по умолчанию не предыдущий рабочий день');
  for (const [block, rows] of [['group', await panelRows('group')], ['top', top], ['heroes', heroes]]) {
    check(!rows.some((r) => r.name === MOCK_VACATIONER), `панель «${block}»: отпускник ${MOCK_VACATIONER} в рейтинге`);
  }

  // выбор дня и группы перерисовывает свой блок и переживает тик обновления
  await choose('select[data-pick="day"]', '2026-11-10');
  check(await valueOf('[data-block="heroes"]', (e) => e.dataset.day) === '2026-11-10', 'герои дня: выбор дня не применился');
  await choose('select[data-pick="group"]', 'СР2');
  await page.waitForTimeout(1_500);
  const sr2 = await panelRows('group');
  check(sr2.length === 3 && sr2.every((r) => r.name.startsWith('Тест СР2-')), `панель «Группа»: СР2 ${JSON.stringify(sr2)}`);
  check(await valueOf('select[data-pick="group"]', (s) => s.value) === 'СР2', 'выбор группы сбросился после тика обновления');
  check(await valueOf('select[data-pick="day"]', (s) => s.value) === '2026-11-10', 'выбор дня сбросился после тика обновления');

  failures.push(...problems);

  // --- бэкенд недоступен: сообщение вместо белого экрана, без необработанных ошибок
  await mock.close();
  mockClosed = true;
  const offline = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const offlineErrors = [];
  offline.on('pageerror', (e) => offlineErrors.push(e.message));
  await offline.goto(live, { waitUntil: 'networkidle' });
  await offline.waitForSelector('[role="status"]:not([hidden])', { timeout: 8_000 }).catch(() => {});
  check((await offline.evaluate(() => document.body.innerText)).includes('Нет связи с сервером'), 'бэкенд недоступен: нет сообщения «Нет связи с сервером»');
  check(offlineErrors.length === 0, `бэкенд недоступен: необработанные ошибки: ${offlineErrors.join('; ')}`);
} finally {
  await browser.close();
  if (!mockClosed) await mock.close();
  await server.close();
}

if (failures.length) {
  console.error(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('OK: демо и живой экран — 6 групп, состояния, кучки, счётчики; рейтинги, «Нет связи», консоль и картинки в порядке');
