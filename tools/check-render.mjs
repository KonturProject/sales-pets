// Проверка экрана с питомцами: поднимает vite и мок-бэкенд, открывает системный Chrome/Edge и сверяет DOM.
// Демо (?demo=1) и живой экран на мок-бэкенде (?backend=): 6 групп, фаза/настроение, кучки, счётчики,
// панель рейтингов (места, ФИО, отпускник вне рейтинга), «Нет связи с сервером» при недоступном бэкенде,
// консоль и картинки. Запуск: npm run check:render
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { MOCK_ADMIN_PIN, MOCK_VACATIONER, startMockBackend } from './mock-backend.mjs';

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
    species: e.querySelector('.species')?.textContent?.trim(),
  })));
  const brokenImages = () => page.$$eval('img', (imgs) => imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
  // чтение и выбор в панели не бросают при отсутствии элемента: провал попадает в список, а не обрывает проверку
  const valueOf = (selector, pick) => page.$eval(selector, pick).catch(() => null);
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
  // вид питомца — сюрприз: до вылупления на табличке «???»
  for (const r of await read()) {
    const ok = r.phase === 'pet' ? !!r.species && r.species !== '???' : r.species === '???';
    check(ok, `демо ${r.group}: на табличке «${r.species}» при фазе ${r.phase}`);
  }
  const broken = await brokenImages();
  check(broken.length === 0, `демо: не загрузились картинки: ${broken.join(', ')}`);

  await page.goto(`${base}?demo=1&asOf=2026-11-11`, { waitUntil: 'networkidle' });
  const eve = (await read()).find((g) => g.group === 'СР9');
  check(eve?.mood === 'dead', `СР9 накануне: mood ${eve?.mood}, ожидалось dead`);
  check(await page.$$eval('.pet[data-kind="grave"] img[src*="grave"]', (els) => els.length) === 1, 'СР9 накануне: на экране нет надгробия');

  // до старта игры: шесть целых яиц, в верхней строке дата старта
  await page.goto(`${base}?demo=1&asOf=2026-11-01`, { waitUntil: 'networkidle' });
  const beforeStart = await read();
  check(beforeStart.length === 6 && beforeStart.every((g) => g.phase === 'egg0'), `до старта: ${JSON.stringify(beforeStart.map((g) => g.phase))}`);
  check((await valueOf('.hud', (e) => e.textContent)).includes('старт 02.11'), 'до старта: в верхней строке нет «старт 02.11»');

  // экран ТВ — одна сцена без прокрутки на Full HD и на 1366×768
  for (const [width, height] of [[1920, 1080], [1366, 768]]) {
    const tv = await browser.newPage({ viewport: { width, height } });
    await tv.goto(`${base}?demo=1`, { waitUntil: 'networkidle' });
    const size = await tv.evaluate(() => ({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth }));
    check(size.sh <= size.ih && size.sw <= size.iw, `${width}×${height}: экран прокручивается ${JSON.stringify(size)}`);
    await tv.close();
  }

  // --- прогулка (фаза Б), часы Playwright: 60 с без ввода включают стену, цикл через 55 с доходит до зала
  {
    const wp = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const walkErrors = [];
    wp.on('pageerror', (e) => walkErrors.push(e.message));
    await wp.clock.install();
    await wp.goto(`${base}?demo=1`, { waitUntil: 'networkidle' });
    const pets = () => wp.$$eval('.pet', (els) => els.map((e) => {
      const m = e.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/);
      return { kind: e.dataset.kind, y: m ? Math.round(Number(m[2])) : NaN, s: m ? Number(m[3]) : NaN };
    }));
    const shot = () => wp.$eval('.tv', (e) => e.dataset.shot);
    const banner = () => wp.$eval('.banner', (e) => (e.classList.contains('on') ? e.textContent : ''));
    const litter = () => wp.$$eval('.tv-world > .confetti, .tv-world > .hall-ball', (e) => e.length);
    const inRooms = (list) => list.every((p) => p.y <= 940 && p.s === 1);
    // узлы без содержимого пузырей и табло: те меняют картинку, а не растут
    const nodes = () => wp.evaluate(() => document.querySelectorAll('*:not(.emote *):not(.ticker *)').length);

    // часы Playwright медленные (≈0,6 с на секунду): паузы без событий перематываются, прогулки идут по-настоящему.
    // Цикл 85 с идёт с загрузки (камера автоматическая и без режима стены): прогулка с 55 по 85 с; pos — где в цикле стоим.
    let pos = 0;
    const toWalk = async (into) => { await wp.clock.fastForward((55_000 - pos + 85_000) % 85_000); await wp.clock.runFor(into); pos = (55_000 + into) % 85_000; };
    await wp.clock.runFor(1_000);
    pos = 1_000;
    check(await shot() === 'rooms', `после загрузки: кадр ${await shot()}, ожидался rooms (цикл без ожидания режима стены)`);
    // с 12 с кадра «комнаты» — крупный план того, кому нужна помощь (в демо СР6 болеет)
    await wp.clock.fastForward(12_000);
    await wp.clock.runFor(1_000);
    pos = 14_000;
    const care = await wp.$eval('.tv', (e) => `${e.dataset.shot}/${e.dataset.focus}`);
    check(care === 'room/СР6' && (await banner()).includes('нужна аптечка'), `визит заботы: кадр ${care}, плашка «${await banner()}»`);
    await toWalk(9_000);
    check(await shot() === 'walk', `прогулка: кадр ${await shot()}, ожидался walk`);
    // ввод не дёргает камеру: прогулка идёт дальше
    await wp.mouse.move(400, 300);
    await wp.mouse.click(30, 500);
    await wp.clock.runFor(1_000);
    pos += 1_000;
    check(await shot() === 'walk', `ввод посреди прогулки: кадр ${await shot()}, ожидался walk`);
    check((await banner()).includes('Прогулка'), `прогулка: плашка «${await banner()}»`);
    const out = (await pets()).filter((p) => p.kind === 'pet');
    check(out.length >= 2 && out.every((p) => p.y > 980 && p.s > 1.4), `прогулка: питомцы не в зале ${JSON.stringify(out)}`);
    await wp.clock.runFor(25_000);
    pos = 89_000 % 85_000;
    check(await shot() === 'rooms', `после прогулки: кадр ${await shot()}`);
    check(inRooms(await pets()), `после прогулки: не все дома ${JSON.stringify(await pets())}`);
    check(await banner() === '' && await litter() === 0, 'после прогулки: осталась плашка, конфетти или мяч');

    // ещё две прогулки целиком не растят DOM: работа на стене сутками
    const before = await nodes();
    for (let k = 0; k < 2; k++) {
      await toWalk(34_000);
      check(inRooms(await pets()) && await litter() === 0, `прогулка ${k + 2}: после неё не все дома или остался мусор`);
    }
    const after = await nodes();
    check(after === before, `три прогулки подряд: узлов было ${before}, стало ${after}`);

    // вкладку скрыли посреди прогулки: через тик экономии все дома, зал пуст
    await toWalk(6_000);
    check(await shot() === 'walk', `скрытие: перед скрытием кадр ${await shot()}, ожидался walk`);
    await wp.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await wp.clock.runFor(16_000);
    check(inRooms(await pets()), `скрытие: не все дома ${JSON.stringify(await pets())}`);
    check(await banner() === '' && await litter() === 0, 'скрытие: осталась плашка, конфетти или мяч');
    check(walkErrors.length === 0, `прогулка: ошибки страницы ${walkErrors.join('; ')}`);
    await wp.close();
  }

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
  const hud = (await valueOf('.hud', (e) => e.textContent)) ?? '';
  check(hud.includes('день 8 из 14') && hud.includes('обновлено') && hud.includes('воронка по 11.11'), `живой экран: верхняя строка «${hud}»`);

  // панель рейтингов: места, полные ФИО, отпускник вне рейтингов
  check(JSON.stringify(await panelRows('group')) === JSON.stringify(SR1_RANKING), `панель «Группа»: ${JSON.stringify(await panelRows('group'))}`);
  const top = await panelRows('top');
  check(top.length >= 1 && top.length <= 10, `панель «Топ-10»: строк ${top.length}`);
  check(JSON.stringify(top[0]) === JSON.stringify(SR1_RANKING[0]), `панель «Топ-10»: первая строка ${JSON.stringify(top[0])}`);
  const heroes = await panelRows('heroes');
  check(heroes.length === 10 && heroes[0].place === 1 && heroes[0].value === 100, `панель «Герои дня»: ${JSON.stringify(heroes.slice(0, 2))} (строк ${heroes.length})`);
  check(await valueOf('[data-block="heroes"]', (e) => e.dataset.day) === '2026-11-11', 'панель «Герои дня»: по умолчанию не предыдущий рабочий день');
  check(await valueOf('.dock-days b', (e) => e.textContent) === '11.11', 'нижняя панель: день героев не 11.11');
  check(await page.$$eval('.tv select', (els) => els.length) === 0, 'экран ТВ: остались системные выпадающие списки');
  const nunito = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some((f) => f.family.includes('Nunito') && f.status === 'loaded');
  });
  check(nunito, 'экран ТВ: шрифт Nunito не загрузился (запасной системный)');
  for (const [block, rows] of [['group', await panelRows('group')], ['top', top], ['heroes', heroes]]) {
    check(!rows.some((r) => r.name === MOCK_VACATIONER), `панель «${block}»: отпускник ${MOCK_VACATIONER} в рейтинге`);
  }

  // доски зала читаются с ТВ: строки не мельче 20 px сцены и целиком внутри доски
  const boardFit = () => page.$$eval('.board', (boards) => boards.map((b) => {
    const cs = getComputedStyle(b);
    const box = b.getBoundingClientRect();
    const k = box.width / b.offsetWidth;
    const bottom = box.bottom - (parseFloat(cs.borderBottomWidth) + parseFloat(cs.paddingBottom)) * k;
    const block = [...b.querySelectorAll('.rank-block')].find((x) => getComputedStyle(x).display !== 'none');
    const rows = block ? [...block.querySelectorAll('tbody tr')] : [];
    const td = block?.querySelector('tbody td');
    return {
      board: `${b.dataset.board}/${b.dataset.slide ?? ''}`,
      rows: rows.length,
      font: td ? parseFloat(getComputedStyle(td).fontSize) : 0,
      out: rows.filter((r) => r.getBoundingClientRect().bottom > bottom + 0.5).length,
    };
  }));
  const fitOk = (f) => f.rows > 0 && f.font >= 20 && f.out === 0;
  const fits = await boardFit();
  await page.click('.dock [data-pick="top"]');
  fits.push(...(await boardFit()).filter((f) => f.board.startsWith('group')));
  check(await valueOf('.tv', (e) => e.dataset.shot) === 'group', 'нижняя панель: «Топ-10» не повела камеру к доске');
  check(await valueOf('.dock [aria-pressed="true"]', (e) => e.dataset.pick) === 'top', 'нижняя панель: «Топ-10» не отмечена');
  await page.click('.dock [data-pick="СР1"]');
  check(fits.length === 3 && fits.every(fitOk), `доски зала: шрифт или строки за краем ${JSON.stringify(fits)}`);

  // выбор дня и группы на нижней панели перерисовывает свой блок и переживает тик обновления
  await page.click('.dock-days button[aria-label="Предыдущий день"]');
  check(await valueOf('[data-block="heroes"]', (e) => e.dataset.day) === '2026-11-10', 'герои дня: выбор дня не применился');
  check(await valueOf('.tv', (e) => e.dataset.shot) === 'heroes', 'нижняя панель: выбор дня не повёл камеру к доске героев');
  await page.click('.dock [data-pick="СР2"]');
  await page.waitForTimeout(1_500);
  const sr2 = await panelRows('group');
  check(sr2.length === 3 && sr2.every((r) => r.name.startsWith('Тест СР2-')), `панель «Группа»: СР2 ${JSON.stringify(sr2)}`);
  check(await valueOf('[data-block="group"]', (e) => e.dataset.shown) === 'СР2', 'выбор группы сбросился после тика обновления');
  check(await valueOf('.dock [aria-pressed="true"]', (e) => e.dataset.pick) === 'СР2', 'нижняя панель: СР2 не отмечена');
  check(await valueOf('[data-block="heroes"]', (e) => e.dataset.day) === '2026-11-10', 'выбор дня сбросился после тика обновления');

  // удержание доски (часы Playwright): выбор дня в конце кадра «группа» (54 с цикла) держит доску 15 с и съедает
  // начало прогулки — прогулка короче, но питомцы дома до смены кадра (а не телепортом); после удержания у героев
  // снова день по умолчанию
  {
    const hp = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await hp.clock.install();
    await hp.goto(live, { waitUntil: 'networkidle' });
    await hp.clock.runFor(1_000);
    const shot = () => hp.$eval('.tv', (e) => e.dataset.shot);
    const heroDay = () => hp.$eval('[data-block="heroes"]', (e) => e.dataset.day);
    const home = () => hp.$$eval('.pet[data-kind="pet"]', (els) => els.map((e) => {
      const m = e.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/);
      return m ? Number(m[2]) <= 940 && Number(m[3]) === 1 : false;
    }));
    await hp.clock.fastForward(53_000);
    await hp.$eval('.dock-days button[aria-label="Предыдущий день"]', (b) => b.click());
    check(await shot() === 'heroes' && await heroDay() === '2026-11-10', `удержание: кадр ${await shot()}, день ${await heroDay()}`);
    await hp.clock.fastForward(16_000);
    check(await shot() === 'walk', `после удержания: кадр ${await shot()}, ожидался walk (остаток прогулки)`);
    check(await heroDay() === '2026-11-11', `после удержания: день героев ${await heroDay()}, ожидался 2026-11-11`);
    await hp.clock.runFor(14_500);
    const atEnd = await home();
    check(atEnd.length >= 2 && atEnd.every(Boolean), `поздняя прогулка: к концу кадра не все дома ${JSON.stringify(atEnd)}`);
    await hp.close();
  }

  // --- рука РГ (R20, R24): расход предмета подхватывает опрос; первый снимок после загрузки молчит.
  // Запасы читаются из DOM, абсолютные числа не предполагаются; PIN группы в вывод не попадает.
  const post = async (body) => (await fetch(mock.url, {
    method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body),
  })).json();
  const sr1 = (what) => `[data-group="СР1"] ${what}`;
  const toysOfSr1 = async () => Number((await valueOf(sr1('[data-count="toys"]'), (e) => e.textContent))?.match(/\d+/)?.[0]);
  const live1s = `${live}&pollMs=1000`;
  await page.goto(live1s, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-group]', { timeout: 8_000 }).catch(() => {});
  check(await page.$$eval('.hand', (h) => h.length) === 0, 'рука: до расхода на экране уже есть .hand');
  let toysBefore = await toysOfSr1();
  if (toysBefore === 0) {
    // у СР1 на 12.11 игрушек нет: выдаём одну админской правкой, чтобы расход не был холостым
    const given = await post({ action: 'setOverride', pin: MOCK_ADMIN_PIN, date: '2026-11-12', group: 'СР1', kind: 'toys', delta: 1 });
    check(given.ok === true, `рука: выдать игрушку СР1: ${given.error}`);
    await page.waitForFunction((s) => /\b1\b/.test(document.querySelector(s)?.textContent ?? ''), sr1('[data-count="toys"]'), { timeout: 5_000 }).catch(() => {});
    toysBefore = await toysOfSr1();
  }
  check(Number.isFinite(toysBefore) && toysBefore > 0, `рука: запас игрушек СР1 не прочитан или нулевой (${toysBefore})`);
  const used = await post({ action: 'useItem', group: 'СР1', groupPin: mock.groupPins['СР1'], item: 'toy', ref: `check-render-${Date.now()}` });
  check(used.ok === true, `рука: useItem: ${used.error}`);
  const hand = await page.waitForSelector(sr1('.hand[data-item="toy"]'), { state: 'attached', timeout: 5_000 }).catch(() => null);
  check(hand !== null, 'рука: .hand[data-item="toy"] у СР1 не появилась за 5 с после расхода');
  check(await toysOfSr1() === toysBefore - 1, `рука: игрушек СР1 ${await toysOfSr1()}, ожидалось ${toysBefore - 1}`);
  check(await page.waitForSelector(sr1('.hand'), { state: 'detached', timeout: 6_000 }).then(() => true, () => false), 'рука: .hand не убралась за 6 с');
  check(await page.$$eval('.hand', (h) => h.length) === 0, 'рука: после ухода остались .hand');

  // --- игрушка дня: после руки игрушка падает в комнату СР1 вместо мяча; у других групп мяч на месте
  const toyRooms = () => page.$$eval('[data-group]', (els) => els.map((e) => {
    const img = e.querySelector('.toy img');
    return {
      group: e.dataset.group, toy: e.dataset.toy ?? null,
      src: img?.getAttribute('src') ?? '', loaded: !!img && img.complete && img.naturalWidth > 0,
      ball: getComputedStyle(e.querySelector('.ball')).visibility,
    };
  }));
  const toyLanded = await page.waitForFunction(() => {
    const room = document.querySelector('[data-group="СР1"]');
    const ball = room?.querySelector('.ball');
    return !!room?.dataset.toy && !!ball && getComputedStyle(ball).visibility === 'hidden';
  }, null, { timeout: 4_000 }).then(() => true, () => false);
  check(toyLanded, 'игрушка: у СР1 нет data-toy или мяч не скрыт за 4 с после руки');
  const toyNow = await toyRooms();
  const sr1Toy = toyNow.find((r) => r.group === 'СР1');
  check(!!sr1Toy?.toy && sr1Toy.src === `assets/toys/${sr1Toy.toy}.png` && sr1Toy.loaded, `игрушка СР1: ${JSON.stringify(sr1Toy)}`);
  const others = toyNow.filter((r) => r.group !== 'СР1');
  check(others.length === 5 && others.every((r) => r.toy === null && r.ball === 'visible'), `игрушка: у других групп ${JSON.stringify(others)}`);

  // --- аптечка (R20): после руки у питомца СР1 вырастает красный плюс `.heal`, ~2 с, и убирается сам.
  // Питомцы в слое мира идут в порядке групп, СР1 первый.
  const sr1Heal = () => page.$$eval('.tv-world > .pet', (els) => els[0]?.querySelectorAll('.heal').length ?? 0);
  const medkitsOfSr1 = async () => Number((await valueOf(sr1('[data-count="medkits"]'), (e) => e.textContent))?.match(/\d+/)?.[0]);
  let medkitsBefore = await medkitsOfSr1();
  if (!(medkitsBefore > 0)) {
    const given = await post({ action: 'setOverride', pin: MOCK_ADMIN_PIN, date: '2026-11-12', group: 'СР1', kind: 'medkits', delta: 1 });
    check(given.ok === true, `аптечка: выдать аптечку СР1: ${given.error}`);
    await page.waitForFunction((s) => /[1-9]/.test(document.querySelector(s)?.textContent ?? ''), sr1('[data-count="medkits"]'), { timeout: 5_000 }).catch(() => {});
    medkitsBefore = await medkitsOfSr1();
  }
  check(Number.isFinite(medkitsBefore) && medkitsBefore > 0, `аптечка: запас аптечек СР1 не прочитан или нулевой (${medkitsBefore})`);
  check(await sr1Heal() === 0, 'аптечка: до расхода у питомца СР1 уже есть .heal');
  const usedKit = await post({ action: 'useItem', group: 'СР1', groupPin: mock.groupPins['СР1'], item: 'medkit', ref: `check-render-${Date.now()}` });
  check(usedKit.ok === true, `аптечка: useItem: ${usedKit.error}`);
  const healed = await page.waitForFunction(() => document.querySelector('.tv-world > .pet .heal') !== null, null, { timeout: 4_000 }).then(() => true, () => false);
  check(healed, 'аптечка: .heal у питомца СР1 не появился после расхода');
  check(await sr1Heal() === 1, `аптечка: .heal у питомца СР1: ${await sr1Heal()}, ожидался 1`);
  check(await page.$eval('.tv-world > .pet', (e) => e.dataset.healing !== undefined), 'аптечка: у питомца СР1 нет data-healing');
  check(await page.waitForFunction(() => document.querySelector('.tv-world > .pet .heal') === null, null, { timeout: 5_000 }).then(() => true, () => false), 'аптечка: .heal не убрался за 5 с');
  check(await page.$eval('.tv-world > .pet', (e) => e.dataset.healing === undefined), 'аптечка: data-healing остался после ухода плюса');

  // после перезагрузки уже совершённый расход не проигрывается (первый снимок молчит)
  await page.goto(live1s, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-group]', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(2_500);
  check(await page.$$eval('.hand', (h) => h.length) === 0, 'рука: при перезагрузке показан прошлый расход');
  // а игрушка дня уже лежит в комнате (без падения)
  check(!!sr1Toy?.toy && await valueOf('[data-group="СР1"]', (e) => e.dataset.toy ?? null) === sr1Toy.toy,`игрушка: после перезагрузки у СР1 data-toy не ${sr1Toy?.toy}`);

  // --- праздник (фаза Б): +1 предварительная оплата у СР3 — плашка, конфетти; через 20 с зал пуст
  check(await page.$eval('.tv', (e) => e.dataset.party ?? '') === '', 'праздник: показан при загрузке страницы');
  const snapshotNow = await (await fetch(mock.url)).json();
  const sr3Today = snapshotNow.provisional.find((p) => p.date === '2026-11-12' && p.group === 'СР3')?.count ?? 0;
  // перед оплатой зритель выбрал день на панели: праздник перебивает удержание, после него у героев снова день по умолчанию
  await page.$eval('.dock-days button[aria-label="Предыдущий день"]', (b) => b.click());
  check(await valueOf('[data-block="heroes"]', (e) => e.dataset.day) === '2026-11-10', 'праздник: выбор дня перед оплатой не применился');
  const paid = await post({ action: 'setProvisional', pin: MOCK_ADMIN_PIN, date: '2026-11-12', group: 'СР3', count: sr3Today + 1 });
  check(paid.ok === true, `праздник: setProvisional: ${paid.error}`);
  const party = await page.waitForSelector('.tv[data-party="СР3"]', { timeout: 6_000 }).catch(() => null);
  check(party !== null, 'праздник: .tv[data-party="СР3"] не появился за 6 с после оплаты');
  const partyBanner = await page.$eval('.banner', (e) => (e.classList.contains('on') ? e.textContent : ''));
  check(partyBanner === 'СР3: +1 оплата! Все на праздник', `праздник: плашка «${partyBanner}»`);
  const confetti = await page.waitForSelector('.tv-world > .confetti', { state: 'attached', timeout: 8_000 }).catch(() => null);
  check(confetti !== null, 'праздник: нет конфетти');
  const over = await page.waitForSelector('.tv:not([data-party])', { timeout: 25_000 }).catch(() => null);
  check(over !== null, 'праздник: не закончился за 25 с');
  await page.waitForTimeout(2_500);
  check(await page.$$eval('.tv-world > .confetti, .tv-world > .hall-ball', (e) => e.length) === 0, 'праздник: после конца остались конфетти или мяч');
  check(await page.$eval('.banner', (e) => !e.classList.contains('on')), 'праздник: плашка не убралась');
  check(await valueOf('[data-block="heroes"]', (e) => e.dataset.day) === '2026-11-11', 'праздник посреди удержания: день героев не вернулся к дню по умолчанию');

  // --- праздник у яйца (первые дни игры — только так): яйцо не выходит в зал, звезда и конфетти над ним
  // повторяются весь праздник, а не один раз, пока камера ещё летит на общий план
  const groupOrder = ['СР1', 'СР2', 'СР3', 'СР5', 'СР6', 'СР9']; // порядок питомцев в мире = GROUPS
  const kinds = () => page.$$eval('.tv-world > .pet', (els) => els.map((e) => ({
    kind: e.dataset.kind, phase: Number(e.querySelector('img')?.getAttribute('src')?.match(/-(\d)\.svg$/)?.[1]),
  })));
  const eggAt = (await kinds()).map((p, i) => ({ ...p, i })).filter((p) => p.kind === 'egg').sort((a, b) => a.phase - b.phase)[0];
  check(eggAt !== undefined, 'праздник у яйца: в моке нет яйца');
  if (eggAt) {
    const eggGroup = groupOrder[eggAt.i];
    const eggToday = (await (await fetch(mock.url)).json()).provisional.find((p) => p.date === '2026-11-12' && p.group === eggGroup)?.count ?? 0;
    const eggPaid = await post({ action: 'setProvisional', pin: MOCK_ADMIN_PIN, date: '2026-11-12', group: eggGroup, count: eggToday + 1 });
    check(eggPaid.ok === true, `праздник у яйца: setProvisional: ${eggPaid.error}`);
    const eggParty = await page.waitForSelector(`.tv[data-party="${eggGroup}"]`, { timeout: 6_000 }).catch(() => null);
    check(eggParty !== null, `праздник у яйца: .tv[data-party="${eggGroup}"] не появился за 6 с после оплаты`);
    check((await kinds())[eggAt.i].kind === 'egg', `праздник у яйца: ${eggGroup} вылупился от одной оплаты — выберите другое яйцо`);
    await page.waitForTimeout(6_000);
    const later = await page.waitForSelector('.tv-world > .confetti', { state: 'attached', timeout: 4_000 }).catch(() => null);
    check(later !== null, 'праздник у яйца: через 6 с после начала конфетти уже нет — праздник виден только в полёте камеры');
    check(await page.waitForSelector('.tv:not([data-party])', { timeout: 20_000 }).then(() => true, () => false), 'праздник у яйца: не закончился');
    await page.waitForTimeout(2_500);
    check(await page.$$eval('.tv-world > .confetti, .tv-world > .hall-ball', (e) => e.length) === 0, 'праздник у яйца: после конца остались конфетти');
  }

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
console.log('OK: демо и живой экран — 6 групп, состояния, кучки, счётчики; рейтинги, рука РГ, «Нет связи», консоль и картинки в порядке');
