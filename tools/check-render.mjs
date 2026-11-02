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
    // Цикл 85 с: прогулка с 55 по 85 с; pos — где в цикле стоим.
    let pos = 0;
    const toWalk = async (into) => { await wp.clock.fastForward((55_000 - pos + 85_000) % 85_000); await wp.clock.runFor(into); pos = (55_000 + into) % 85_000; };
    await wp.clock.fastForward(61_000); // 60 с без ввода — режим стены
    await wp.clock.runFor(1_000);
    pos = 1_000;
    await toWalk(9_000);
    check(await shot() === 'walk', `прогулка: кадр ${await shot()}, ожидался walk`);
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
  check(await valueOf('select[data-pick="day"]', (s) => s.value) === '2026-11-11', 'панель «Герои дня»: по умолчанию не предыдущий рабочий день');
  for (const [block, rows] of [['group', await panelRows('group')], ['top', top], ['heroes', heroes]]) {
    check(!rows.some((r) => r.name === MOCK_VACATIONER), `панель «${block}»: отпускник ${MOCK_VACATIONER} в рейтинге`);
  }

  // доски зала читаются с ТВ: строки не мельче 20 px сцены и целиком внутри доски, кнопка «Топ-10» строк не закрывает
  const boardFit = () => page.$$eval('.board', (boards) => boards.map((b) => {
    const cs = getComputedStyle(b);
    const box = b.getBoundingClientRect();
    const k = box.width / b.offsetWidth;
    const bottom = box.bottom - (parseFloat(cs.borderBottomWidth) + parseFloat(cs.paddingBottom)) * k;
    const block = [...b.querySelectorAll('.rank-block')].find((x) => getComputedStyle(x).display !== 'none');
    const rows = block ? [...block.querySelectorAll('tbody tr')] : [];
    const toggle = b.querySelector('.board-toggle')?.getBoundingClientRect();
    const td = block?.querySelector('tbody td');
    return {
      board: `${b.dataset.board}/${b.dataset.slide ?? ''}`,
      rows: rows.length,
      font: td ? parseFloat(getComputedStyle(td).fontSize) : 0,
      out: rows.filter((r) => r.getBoundingClientRect().bottom > bottom + 0.5).length,
      underToggle: toggle ? rows.filter((r) => { const q = r.getBoundingClientRect(); return q.bottom > toggle.top && q.top < toggle.bottom; }).length : 0,
    };
  }));
  const fitOk = (f) => f.rows > 0 && f.font >= 20 && f.out === 0 && f.underToggle === 0;
  const fits = await boardFit();
  await page.click('.board-toggle');
  fits.push(...(await boardFit()).filter((f) => f.board.startsWith('group')));
  await page.click('.board-toggle');
  check(fits.length === 3 && fits.every(fitOk), `доски зала: шрифт или строки за краем ${JSON.stringify(fits)}`);

  // выбор дня и группы перерисовывает свой блок и переживает тик обновления
  await choose('select[data-pick="day"]', '2026-11-10');
  check(await valueOf('[data-block="heroes"]', (e) => e.dataset.day) === '2026-11-10', 'герои дня: выбор дня не применился');
  await choose('select[data-pick="group"]', 'СР2');
  await page.waitForTimeout(1_500);
  const sr2 = await panelRows('group');
  check(sr2.length === 3 && sr2.every((r) => r.name.startsWith('Тест СР2-')), `панель «Группа»: СР2 ${JSON.stringify(sr2)}`);
  check(await valueOf('select[data-pick="group"]', (s) => s.value) === 'СР2', 'выбор группы сбросился после тика обновления');
  check(await valueOf('select[data-pick="day"]', (s) => s.value) === '2026-11-10', 'выбор дня сбросился после тика обновления');

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

  // после перезагрузки уже совершённый расход не проигрывается (первый снимок молчит)
  await page.goto(live1s, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-group]', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(2_500);
  check(await page.$$eval('.hand', (h) => h.length) === 0, 'рука: при перезагрузке показан прошлый расход');

  // --- праздник (фаза Б): +1 предварительная оплата у СР3 — плашка, конфетти; через 20 с зал пуст
  check(await page.$eval('.tv', (e) => e.dataset.party ?? '') === '', 'праздник: показан при загрузке страницы');
  const snapshotNow = await (await fetch(mock.url)).json();
  const sr3Today = snapshotNow.provisional.find((p) => p.date === '2026-11-12' && p.group === 'СР3')?.count ?? 0;
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
