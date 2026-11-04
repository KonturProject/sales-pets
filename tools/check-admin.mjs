// Проверка страниц админки и РГ: поднимает vite и мок-бэкенд, открывает системный Chrome/Edge.
// Каждый сценарий получает свой мок-бэкенд и свой контекст браузера (R25): сценарии меняют общее состояние.
// Начальные значения читаются из DOM перед действием. PIN в вывод не попадает. Запуск: npm run check:admin
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

const GROUP_CODES = ['СР1', 'СР2', 'СР3', 'СР5', 'СР6', 'СР9'];
const failures = [];

const server = await createServer({ logLevel: 'error', server: { port: 0 } });
await server.listen();
const { port } = server.httpServer.address();
const base = `http://localhost:${port}/`;
const browser = await chromium.launch({ executablePath: browserPath });

/** Свежий мок и контекст; ошибки консоли, страницы и сети становятся провалами сценария. */
async function scenario(name, fn) {
  const mock = await startMockBackend({ port: 0 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const logs = []; // весь вывод консоли: по нему проверяем, что PIN туда не попал
  const fail = (message) => failures.push(`${name}: ${message}`);
  const check = (ok, message) => { if (!ok) fail(message); };
  const watch = (page) => {
    page.on('console', (m) => {
      logs.push(m.text());
      if (m.type() === 'error') fail(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => fail(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => fail(`request failed: ${r.url()}`));
    page.on('response', (r) => { if (r.status() >= 400) fail(`HTTP ${r.status()}: ${r.url()}`); });
  };
  const newPage = async () => { const page = await context.newPage(); watch(page); return page; };
  const backend = `backend=${encodeURIComponent(mock.url)}`;
  const urls = {
    admin: `${base}admin.html?${backend}`,
    rg: `${base}rg.html?${backend}`,
    // общий экран на дату мока, опрос раз в секунду
    screen: `${base}?${backend}&asOf=2026-11-12&pollMs=1000`,
  };
  try {
    await fn({ mock, newPage, check, fail, urls, logs });
  } catch (e) {
    fail(`сценарий прервался: ${e.message}`);
  } finally {
    await context.close();
    await mock.close();
  }
}

/** Вход в админку с PIN мока; открывается первая вкладка — «Итоги». */
async function loginAdmin(page, url, pin = MOCK_ADMIN_PIN) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.fill('form[data-login] input[type="password"]', pin);
  await page.click('form[data-login] button[type="submit"]');
}

// Фикстуры xlsx живут в src/import/fixtures.ts (вымышленные имена); vite собирает их на лету
const fx = await server.ssrLoadModule('/src/import/fixtures.ts');
const xlsxFile = (name, buffer) => ({ name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(buffer) });
const publicSnapshot = async (mock) => (await fetch(mock.url)).json();
const textOf = (page, selector) => page.$eval(selector, (e) => e.textContent ?? '').catch(() => '');
/** Ждёт, пока текст элемента не будет содержать подстроку; возвращает итоговый текст. */
async function waitForText(page, selector, needle, timeout = 8_000) {
  await page.waitForFunction(([sel, text]) => document.querySelector(sel)?.textContent?.includes(text), [selector, needle], { timeout }).catch(() => {});
  return textOf(page, selector);
}

const subOfSr1 = (page) => page.$eval('[data-group="СР1"] .sub', (e) => e.textContent ?? '').catch(() => '');
const paymentsOf = (text) => Number(text.match(/оплат (\d+)/)?.[1]);

try {
  await scenario('вход', async ({ newPage, check, urls }) => {
    const page = await newPage();
    await page.goto(urls.admin, { waitUntil: 'networkidle' });
    const input = page.locator('form[data-login] input[type="password"]');
    check(await input.count() === 1, 'нет поля PIN во входе');
    check(await input.getAttribute('name') === null, 'у поля PIN есть атрибут name');
    const alert = () => page.$eval('[role="alert"]', (e) => e.textContent ?? '').catch(() => '');
    for (let i = 1; i <= 5; i++) {
      await input.fill('9999');
      await page.click('form[data-login] button[type="submit"]');
      const want = i < 5 ? 'Неверный PIN' : 'Заблокировано';
      await page.waitForFunction((t) => document.querySelector('[role="alert"]')?.textContent?.includes(t), want, { timeout: 5_000 }).catch(() => {});
      check((await alert()).includes(want), `попытка ${i}: ожидалось «${want}», на экране «${await alert()}»`);
    }
    check(await page.locator('[role="tab"]').count() === 0, 'после неверных PIN показаны вкладки');
  });

  await scenario('оплаты → экран', async ({ newPage, check, urls }) => {
    const screen = await newPage();
    await screen.goto(urls.screen, { waitUntil: 'networkidle' });
    await screen.waitForSelector('[data-group="СР1"] .sub', { timeout: 8_000 });
    const before = paymentsOf(await subOfSr1(screen));
    check(Number.isFinite(before), `экран: оплаты СР1 не прочитаны («${await subOfSr1(screen)}»)`);

    const admin = await newPage();
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="payments"]');
    await admin.waitForSelector('[data-pay="СР1"]', { timeout: 8_000 });
    check(await admin.$eval('[data-today]', (e) => e.dataset.today) === '2026-11-12', 'вкладка «Оплаты»: «сегодня» не по часам сервера (12.11 в моке)');
    check(await admin.locator('[data-pay]').count() === GROUP_CODES.length, 'вкладка «Оплаты»: поле не у каждой группы');
    const current = Number(await admin.inputValue('[data-pay="СР1"]'));
    await admin.fill('[data-pay="СР1"]', String(current + 5));
    await admin.click('button[type="submit"]');
    await admin.waitForFunction(() => /Сохранено/.test(document.querySelector('[role="status"]')?.textContent ?? ''), null, { timeout: 5_000 }).catch(() => {});
    check((await admin.$eval('[role="status"]', (e) => e.textContent ?? '')).includes('СР1'), 'вкладка «Оплаты»: нет подтверждения сохранения');

    await screen.waitForFunction((want) => Number(document.querySelector('[data-group="СР1"] .sub')?.textContent?.match(/оплат (\d+)/)?.[1]) === want, before + 5, { timeout: 8_000 }).catch(() => {});
    check(paymentsOf(await subOfSr1(screen)) === before + 5, `экран: оплат СР1 ${paymentsOf(await subOfSr1(screen))}, ожидалось ${before + 5}`);

    // значение вне диапазона не уходит на сервер
    await admin.fill('[data-pay="СР1"]', '10001');
    await admin.click('button[type="submit"]');
    check((await admin.$eval('[role="status"]', (e) => e.textContent ?? '')).includes('СР1'), 'вкладка «Оплаты»: число вне диапазона не отклонено');
  });

  await scenario('телефон 390 px: ни одна вкладка не шире экрана', async ({ newPage, check, urls }) => {
    const admin = await newPage();
    await admin.setViewportSize({ width: 390, height: 800 });
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="payments"]');
    await admin.waitForSelector('[data-pay="СР1"]', { timeout: 8_000 });
    // −/+ у группы меняют число и подсвечивают несохранённое; без «Сохранить» на сервер ничего не уходит
    const was = Number(await admin.inputValue('[data-pay="СР2"]'));
    await admin.click('[aria-label="СР2: на одну больше"]');
    await admin.click('[aria-label="СР2: на одну больше"]');
    await admin.click('[aria-label="СР2: на одну меньше"]');
    check(Number(await admin.inputValue('[data-pay="СР2"]')) === was + 1, 'оплаты: −/+ не меняют число');
    check(await admin.$$eval('.pay-card.changed', (c) => c.length) === 1, 'оплаты: несохранённое число не подсвечено');
    const tasks = await textOf(admin, '[data-today-tasks]');
    check(tasks.includes('Штат: 25') && tasks.includes('Воронка по 11.11'), `блок «Сегодня»: дела «${tasks}»`);
    for (const tab of await admin.$$eval('[role="tab"]', (t) => t.map((x) => x.dataset.tab))) {
      await admin.click(`[role="tab"][data-tab="${tab}"]`);
      await admin.waitForTimeout(1_200);
      const wide = await admin.evaluate(() => document.documentElement.scrollWidth);
      check(wide <= 390, `телефон: вкладка «${tab}» шириной ${wide} px — страница прокручивается вбок`);
    }
  });

  await scenario('оплаты: вкладка открыта со вчера', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    let nextDay = false; // снимки сервера «уже 13.11»: вкладку открыли 12.11 и оставили на ночь
    await admin.route(`${mock.url}**`, async (route) => {
      if (!nextDay || route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const snap = await response.json();
      snap.serverNow = '2026-11-13T00:00:05+03:00';
      return route.fulfill({ response, body: JSON.stringify(snap) });
    });
    let writes = 0;
    admin.on('request', (r) => { if (r.method() === 'POST' && JSON.parse(r.postData() ?? '{}').action === 'setProvisional') writes++; });
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="payments"]');
    await admin.waitForSelector('[data-pay="СР1"]', { timeout: 8_000 });
    nextDay = true;
    // утром вводят те же числа, что стоят в полях со вчера: это не «изменений нет», а новый день
    await admin.click('form button[type="submit"]');
    const said = await waitForText(admin, 'form [role="status"]', 'Наступило');
    check(said.includes('Наступило 13.11'), `те же числа на следующий день: «${said}»`);
    check(await admin.$eval('[data-today]', (e) => e.dataset.today) === '2026-11-13', 'вкладка «Оплаты»: поля не перешли на новый день');
    check(writes === 0, `вкладка «Оплаты»: на смене дня ушло записей: ${writes}`);
  });

  await scenario('PIN-коды', async ({ mock, newPage, check, urls, logs }) => {
    const admin = await newPage();
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="pins"]');
    await admin.click('text=Выпустить PIN групп');
    check(await admin.locator('output table').count() === 0, 'PIN показаны без подтверждения');
    await admin.click('text=Да, выпустить');
    await admin.waitForSelector('output td', { timeout: 5_000 });
    const pins = await admin.$$eval('output td', (cells) => cells.map((c) => c.textContent ?? ''));
    check(pins.length === GROUP_CODES.length && pins.every((p) => /^\d{6}$/.test(p)), `выпущено ${pins.length} PIN, не все из 6 цифр`);

    // выпущенный PIN действительно открывает группу
    const reply = await (await fetch(mock.url, {
      method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'groupLogin', group: 'СР1', groupPin: pins[0] }),
    })).json();
    check(reply.ok === true, 'выпущенный PIN СР1 не принят сервером');

    // контроль: до закрытия PIN в DOM есть, иначе проверка ниже ничего бы не доказывала
    check((await admin.evaluate(() => document.documentElement.outerHTML)).includes(pins[0]), 'контроль: PIN не виден до «Закрыть»');
    await admin.click('text=Закрыть');
    const html = await admin.evaluate(() => document.documentElement.outerHTML);
    const storage = await admin.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
    for (const pin of pins) {
      check(!html.includes(pin), 'после «Закрыть» PIN группы остался в DOM');
      check(!storage.includes(pin), 'PIN группы попал в хранилище');
      check(!admin.url().includes(pin), 'PIN группы попал в адрес');
      check(!logs.some((l) => l.includes(pin)), 'PIN группы попал в консоль');
    }
    // PIN администратора: ни в адресе, ни в хранилище, ни в консоли, ни в значении полей
    check(!admin.url().includes(MOCK_ADMIN_PIN), 'PIN администратора в адресе');
    check(!storage.includes(MOCK_ADMIN_PIN), 'PIN администратора в хранилище');
    check(!logs.some((l) => l.includes(MOCK_ADMIN_PIN)), 'PIN администратора в консоли');
    check(!html.includes(`value="${MOCK_ADMIN_PIN}"`), 'PIN администратора в значении поля');

    // смена админ-PIN: несовпадение ловится до сервера; новый работает, старый нет; сессия жива; PIN нигде не остался
    const NEW_PIN = '48151623';
    const pinField = (label) => `[data-new-pin][aria-label="${label}"]`;
    await admin.fill(pinField('Новый PIN'), NEW_PIN);
    await admin.fill(pinField('Новый PIN ещё раз'), '48151624');
    await admin.click('text=Сменить админ-PIN');
    check((await waitForText(admin, '[data-alert="admin-pin"]', 'не совпадают')).includes('не совпадают'), 'смена PIN: несовпадение не поймано');
    await admin.fill(pinField('Новый PIN'), NEW_PIN);
    await admin.fill(pinField('Новый PIN ещё раз'), NEW_PIN);
    await admin.click('text=Сменить админ-PIN');
    const changed = await waitForText(admin, '[data-status="admin-pin"]', 'изменён');
    check(changed.includes('Админ-PIN изменён'), `смена PIN: «${changed}» / «${await textOf(admin, '[data-alert="admin-pin"]')}»`);
    check(await admin.$$eval('[data-new-pin]', (f) => f.every((i) => i.value === '')), 'смена PIN: поля не очищены');
    const login = async (pin) => (await (await fetch(mock.url, {
      method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'login', pin }),
    })).json()).ok === true;
    check(await login(NEW_PIN), 'смена PIN: новый PIN не принят сервером');
    check(!(await login(MOCK_ADMIN_PIN)), 'смена PIN: старый PIN ещё работает');
    await admin.click('[role="tab"][data-tab="staff"]');
    await admin.waitForSelector('[data-staff-list]', { timeout: 8_000 }).catch(() => {});
    check(await admin.locator('form[data-login]').count() === 0, 'смена PIN: сессия вышла, хотя PIN сменили из неё');
    const after = await admin.evaluate(() => [document.documentElement.outerHTML, JSON.stringify([{ ...localStorage }, { ...sessionStorage }])].join('|'));
    check(!after.includes(NEW_PIN) && !admin.url().includes(NEW_PIN) && !logs.some((l) => l.includes(NEW_PIN)), 'новый админ-PIN остался в DOM, хранилище, адресе или консоли');
  });

  await scenario('сотрудники: уровни и даты приёма всем сразу, блок «Сегодня»', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    await loginAdmin(admin, urls.admin);
    const today = await waitForText(admin, '[data-today-line]', 'Сегодня');
    check(today.includes('Сегодня 12.11') && today.includes('день 8 из 14') && today.includes('воронка по 11.11'), `блок «Сегодня»: «${today}»`);
    await admin.click('[role="tab"][data-tab="staff"]');
    await admin.waitForSelector('[data-bulk-row]', { timeout: 8_000 });
    const staffBefore = (await publicSnapshot(mock)).staff;
    check(await admin.$$eval('[data-bulk-row]', (r) => r.length) === staffBefore.length, 'таблица уровней: не все сотрудники');
    check((await textOf(admin, '[data-bulk-save]')).endsWith('(0)'), `таблица уровней: без правок кнопка «${await textOf(admin, '[data-bulk-save]')}»`);
    const id = await admin.$eval('[data-bulk-row]', (r) => r.dataset.bulkRow);
    const was = staffBefore.find((e) => e.id === id);
    const level = was.baseLevel === 'rookie1' ? 'rookie2' : 'rookie1';
    await admin.selectOption(`[data-bulk-level="${id}"]`, level);
    await admin.fill(`[data-bulk-hire="${id}"]`, '2026-10-26');
    check((await textOf(admin, '[data-bulk-save]')).endsWith('(1)'), `таблица уровней: после правки кнопка «${await textOf(admin, '[data-bulk-save]')}»`);
    await admin.click('[data-bulk-save]');
    const saved = await waitForText(admin, '[data-status="bulk"]', 'Сохранено строк: 1');
    check(saved.includes('Сохранено строк: 1'), `таблица уровней: «${saved}» / «${await textOf(admin, '[data-alert="bulk"]')}»`);
    const staffAfter = (await publicSnapshot(mock)).staff;
    const me = staffAfter.find((e) => e.id === id);
    check(me.baseLevel === level && me.hireDate === '2026-10-26', `таблица уровней: записано ${me.baseLevel} ${me.hireDate}`);
    const untouched = staffAfter.filter((e) => e.id !== id).every((e) => JSON.stringify(e) === JSON.stringify(staffBefore.find((b) => b.id === e.id)));
    check(untouched, 'таблица уровней: задеты другие сотрудники');
    check((await textOf(admin, '[data-bulk-save]')).endsWith('(0)'), 'таблица уровней: после записи не перерисована из снимка');

    // недописанная дата (стёрт один сегмент) — у поля пустое value: без проверки ушло бы «даты приёма нет»
    await admin.click(`[data-bulk-hire="${id}"]`);
    await admin.keyboard.press('Backspace');
    check(await admin.$eval(`[data-bulk-hire="${id}"]`, (i) => i.validity.badInput), 'таблица уровней: Backspace не сделал дату недописанной');
    await admin.click('[data-bulk-save]');
    const half = await waitForText(admin, '[data-alert="bulk"]', 'не полностью');
    check(half.includes('Строка 1: дата приёма введена не полностью'), `таблица уровней: недописанная дата — «${half}»`);
    check((await publicSnapshot(mock)).staff.find((e) => e.id === id).hireDate === '2026-10-26', 'таблица уровней: недописанная дата стёрла дату приёма на сервере');
  });

  await scenario('импорт оплат → экран', async ({ mock, newPage, check, urls }) => {
    const screen = await newPage();
    await screen.goto(urls.screen, { waitUntil: 'networkidle' });
    await screen.waitForSelector('[data-group="СР1"] .sub', { timeout: 8_000 });
    const before = paymentsOf(await subOfSr1(screen));
    const sr1Day = (s) => s.payments.filter((p) => p.group === 'СР1' && p.date === '2026-11-11').length;
    const dayBefore = sr1Day(await publicSnapshot(mock));

    const admin = await newPage();
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="import"]');
    const file = xlsxFile('pay.xlsx', fx.paymentsXlsx(['FX-1', 'FX-2', 'FX-3', 'FX-4'].map((invoice) => ({ date: '2026-11-11', group: 'СР1', author: 'Тест Один', invoice }))));
    await admin.setInputFiles('[data-file="payments"]', file);
    const preview = await waitForText(admin, '[data-report="payments"]', 'Оплат к загрузке: 4');
    check(preview.includes('Оплат к загрузке: 4'), `превью оплат: «${preview}»`);
    check(preview.includes('11.11.2026'), 'превью оплат: не указан период');
    check(preview.includes('По группам: СР1 4 · СР2 0'), `превью оплат: нет разбивки по группам «${preview}»`);
    check(preview.includes('Авторы не найдены в штате (1): Тест Один'), `превью оплат: не назван автор вне штата «${preview}»`);
    check(preview.includes('Привязано к сотрудникам: 0 из 4 оплат'), `превью оплат: нет строки о привязке к сотрудникам «${preview}»`);
    check(sr1Day(await publicSnapshot(mock)) === dayBefore, 'превью записало оплаты до подтверждения');

    await admin.click('[data-confirm="payments"]');
    check((await waitForText(admin, '[data-report="payments"]', 'Загружено оплат: 4')).includes('Загружено оплат: 4'), 'нет подтверждения загрузки оплат');
    const want = before - dayBefore + 4;
    await screen.waitForFunction((n) => Number(document.querySelector('[data-group="СР1"] .sub')?.textContent?.match(/оплат (\d+)/)?.[1]) === n, want, { timeout: 8_000 }).catch(() => {});
    check(paymentsOf(await subOfSr1(screen)) === want, `экран: оплат СР1 ${paymentsOf(await subOfSr1(screen))}, ожидалось ${want}`);

    // тот же файл ещё раз: оплаты периода заменяются, а не складываются
    await admin.setInputFiles('[data-file="payments"]', file);
    check((await waitForText(admin, '[data-report="payments"]', 'заменится прежних')).includes('заменится прежних: 4'), 'повтор файла: превью не видит прежние оплаты периода');
    await admin.click('[data-confirm="payments"]');
    await waitForText(admin, '[data-report="payments"]', 'Загружено оплат');
    await screen.waitForTimeout(2_500); // два опроса экрана
    check(paymentsOf(await subOfSr1(screen)) === want, `повтор файла изменил число оплат СР1: ${paymentsOf(await subOfSr1(screen))}, ожидалось ${want}`);
  });

  await scenario('импорт воронки: новый сотрудник', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="import"]');
    const staffBefore = (await publicSnapshot(mock)).staff.length;
    const days = ['2026-11-09', '2026-11-10', '2026-11-11'];
    const file = xlsxFile('funnel.xlsx', fx.funnelXlsx(days, [{ group: 'СР1', people: [{ name: 'Тест Новый', quality: 4, long: 2 }] }]));
    await admin.setInputFiles('[data-file="funnel"]', file);
    const preview = await waitForText(admin, '[data-report="funnel"]', 'Новых сотрудников: 1');
    check(preview.includes('Новых сотрудников: 1'), `превью воронки: «${preview}»`);
    check(preview.includes('11.11.2026'), 'превью воронки: не указана дата «по»');
    check(preview.includes('СР1: Тест Новый'), `превью воронки: новый сотрудник не назван по имени и группе: «${preview}»`);
    check(preview.includes('«Сотрудники»'), 'превью воронки: нет указания проверить дату приёма и уровень во вкладке «Сотрудники»');
    const button = await textOf(admin, '[data-confirm="funnel"]');
    check(button.includes('Добавить новых (1)'), `подпись кнопки: «${button}»`);
    check((await publicSnapshot(mock)).staff.length === staffBefore, 'штат пополнился до подтверждения');

    await admin.click('[data-confirm="funnel"]');
    const done = await waitForText(admin, '[data-report="funnel"]', 'Загружено строк воронки');
    check(done.includes('Загружено строк воронки: 3') && done.includes('добавлено сотрудников: 1'), `итог воронки: «${done}»`);
    const after = await publicSnapshot(mock);
    check(after.staff.length === staffBefore + 1 && after.staff.some((e) => e.name === 'Тест Новый' && e.group === 'СР1'), 'сотрудник не добавлен в штат в группе из файла');
    check(after.funnel.some((r) => r.date === '2026-11-11' && r.quality === 4 && r.long === 2), 'строки воронки не загружены');

    // тот же файл снова: сотрудник уже в штате, предлагается просто «Загрузить»
    await admin.setInputFiles('[data-file="funnel"]', file);
    await waitForText(admin, '[data-report="funnel"]', 'Данные по');
    check(await textOf(admin, '[data-confirm="funnel"]') === 'Загрузить', 'повтор файла: сотрудник снова считается новым');
    check(!(await textOf(admin, '[data-report="funnel"]')).includes('Новых сотрудников'), 'повтор файла: в превью снова «Новых сотрудников»');
  });

  await scenario('импорт воронки 02.11: первая загрузка берёт только штат', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    // снимки сервера «сегодня 02.11»: первый день игры, дней игры до сегодняшнего ещё нет
    await admin.route(`${mock.url}**`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const snap = await response.json();
      snap.serverNow = '2026-11-02T10:00:00+03:00';
      return route.fulfill({ response, body: JSON.stringify(snap) });
    });
    const actions = [];
    admin.on('request', (r) => { if (r.method() === 'POST') actions.push(JSON.parse(r.postData() ?? '{}').action); });
    const before = await publicSnapshot(mock);
    const known = before.staff.find((e) => e.group === 'СР1').name;
    // штат целиком: по 10 новых в каждой группе и один уже известный
    const groups = GROUP_CODES.map((group) => ({
      group,
      people: [
        ...(group === 'СР1' ? [{ name: known, quality: 1, long: 1 }] : []),
        ...Array.from({ length: 10 }, (_, i) => ({ name: `Новый ${group} Номер${i + 1}`, quality: 2, long: 1 })),
      ],
    }));
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="import"]');
    await admin.setInputFiles('[data-file="funnel"]', xlsxFile('funnel-oct.xlsx', fx.funnelXlsx(['2026-10-29', '2026-10-30'], groups)));
    const preview = await waitForText(admin, '[data-report="funnel"]', 'Первая загрузка');
    check(preview.includes('Сотрудников в файле: 61; уже в штате: 1; новых: 60'), `первая воронка: превью «${preview}»`);
    check(preview.includes('СР9 10'), `первая воронка: нет счёта по группам: «${preview}»`);
    check(await textOf(admin, '[data-confirm="funnel"]') === 'Добавить в штат (60)', `первая воронка: кнопка «${await textOf(admin, '[data-confirm="funnel"]')}»`);
    await admin.click('[data-confirm="funnel"]');
    const done = await waitForText(admin, '[data-report="funnel"]', 'Добавлено в штат');
    check(done.includes('Добавлено в штат: 60'), `первая воронка: итог «${done}» / «${await textOf(admin, '[data-alert="funnel"]')}»`);
    const after = await publicSnapshot(mock);
    check(after.staff.length === before.staff.length + 60, `первая воронка: в штате ${after.staff.length}, ожидалось ${before.staff.length + 60}`);
    check(after.staff.some((e) => e.name === 'Новый СР6 Номер3' && e.group === 'СР6' && e.baseLevel === 'experienced'), 'первая воронка: новый сотрудник не в группе из файла');
    check(after.funnel.length === before.funnel.length, 'первая воронка: загрузились показатели до старта игры');
    check(actions.includes('setStaff') && !actions.includes('importFunnel'), `первая воронка: действия ${actions.join(', ')}`);
  });

  // Разбор загрузки: таблица «Итогов» «как будто файл уже загружен». Файлы строятся из штата мока (у новых сотрудников нет «Поправить»).
  const DAY_BEFORE = '2026-11-10';
  const LAST_DAY = '2026-11-11';
  const post = (mock, body) => fetch(mock.url, {
    method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ pin: MOCK_ADMIN_PIN, ...body }),
  }).then((r) => r.json());
  /** Действия POST (без PIN и тел), чтобы проверять, что ушло на сервер. */
  const trackPosts = (page) => {
    const posts = [];
    page.on('request', (r) => {
      if (r.method() !== 'POST') return;
      const body = JSON.parse(r.postData() ?? '{}');
      posts.push({ action: body.action, dryRun: body.dryRun, items: body.items });
    });
    return posts;
  };

  await scenario('импорт воронки: разбор до загрузки, «Поправить» пишет правку и пересчитывает с тем же файлом', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    const posts = trackPosts(admin);
    await loginAdmin(admin, urls.admin);
    await admin.waitForSelector('table.results', { timeout: 8_000 });
    // группа, у которой сейчас (по серверу) за 11.11 «Аптечка»: файл с нулями её перевернёт
    const outcomes = await admin.$$eval('[data-outcome]', (els) => els.map((e) => [e.dataset.outcome, e.textContent ?? '']));
    const g = outcomes.find((o) => o[1].includes('Аптечка, −1 кучка'))?.[0];
    check(Boolean(g), `ни у одной группы нет «Аптечка, −1 кучка»: ${JSON.stringify(outcomes)}`);
    if (!g) return;
    const before = await publicSnapshot(mock);
    const other = before.staff.find((e) => e.group !== g);
    const file = xlsxFile('funnel-zero.xlsx', fx.funnelXlsx([DAY_BEFORE, LAST_DAY], [
      { group: g, people: before.staff.filter((e) => e.group === g).map((e) => ({ name: e.name, quality: 0, long: 0 })) },
      { group: other.group, people: [{ name: other.name, quality: 1, long: 1 }] },
    ]));

    await admin.click('[role="tab"][data-tab="import"]');
    await admin.setInputFiles('[data-file="funnel"]', file);
    const box = '[data-report="funnel"] [data-preview="funnel"]';
    const shown = await admin.waitForSelector(`${box} table.results`, { timeout: 8_000 }).then(() => true, () => false);
    check(shown, 'разбор воронки: нет таблицы «Итогов» до загрузки');
    if (!shown) return;
    const text = (selector) => textOf(admin, selector);
    check((await text(box)).includes('Итоги за 11.11'), `разбор воронки: заголовок таблицы «${(await text(box)).slice(0, 80)}»`);
    check(await admin.locator(`${box} tbody[data-group]`).count() === GROUP_CODES.length, 'разбор воронки: в таблице не шесть групп');
    const outcome = await text(`${box} [data-outcome="${g}"]`);
    check(outcome.includes('+1 кучка') && !outcome.includes('Аптечка'), `итог дня ${g} в разборе (файл с нулями): «${outcome}»`);
    const days = await text(`${box} [data-effects="days"]`);
    check(days.includes('Изменятся итоги прошлых дней') && new RegExp(`${g} 11[.]11: аптечка[^→]* → [+]1 кучка`).test(days), `«Изменятся итоги прошлых дней»: «${days}»`);
    const now = await text(`${box} [data-effects="now"]`);
    check(now.includes('Сейчас станет') && now.includes(`${g}:`), `«Сейчас станет»: «${now}»`);
    check(await admin.locator(`${box} [data-effects="stale"]`).count() === 0, 'разбор воронки: устаревшие правки там, где правок нет');
    const unchanged = await publicSnapshot(mock);
    check(unchanged.funnelThrough === before.funnelThrough && unchanged.funnel.length === before.funnel.length, 'разбор воронки записал данные до «Загрузить»');
    check(!posts.some((p) => p.action === 'importFunnel' || p.action === 'addCorrections'), `разбор воронки: до «Загрузить» ушло ${JSON.stringify(posts.map((p) => p.action))}`);

    // «Поправить» в разборе: значения «после загрузки файла», а не те, что лежат на сервере
    await admin.evaluate(() => { window.__confirm = document.querySelector('[data-confirm="funnel"]'); });
    await admin.click(`${box} [data-group-toggle="${g}"]`);
    const ids = await admin.$$eval(`${box} tbody[data-group="${g}"] tr[data-employee-row]`, (rows) => rows.filter((r) => !(r.textContent ?? '').includes('не входит в итог группы')).map((r) => r.dataset.employeeRow));
    const serverLong = (id) => before.funnel.find((r) => r.employeeId === id && r.date === LAST_DAY)?.long ?? 0;
    const id = ids.find((x) => serverLong(x) > 0) ?? ids[0];
    check(serverLong(id) > 0, 'контроль: у выбранного сотрудника на сервере длинные за 11.11 равны 0, проверка ничего не докажет');
    await admin.click(`${box} button[data-correct="${id}"]`);
    check(await admin.inputValue(`${box} [data-edit="long"]`) === '0', `в редакторе разбора длинные «${await admin.inputValue(`${box} [data-edit="long"]`)}», в файле 0 (на сервере ${serverLong(id)})`);
    check((await text(`${box} [data-caption="long"]`)).trim() === 'из файла 0', `подпись длинных в разборе «${await text(`${box} [data-caption="long"]`)}»`);
    const cell = `${box} tbody[data-group="${g}"] .group-row [data-cell="day-long"]`;
    const [, , planText] = (await text(cell)).replace(/,/g, '.').match(/^(\d+(?:\.\d+)?) \/ (\d+(?:\.\d+)?)/) ?? [];
    const need = Math.ceil(Number(planText));
    check(need > 0 && need <= 50, `план длинных группы в разборе «${await text(cell)}»`);
    await admin.fill(`${box} [data-edit="long"]`, String(need));
    await admin.click(`${box} [data-save="correction"]`);
    const flipped = await waitForText(admin, `${box} [data-outcome="${g}"]`, 'Аптечка, −1 кучка');
    check(flipped.includes('Аптечка, −1 кучка'), `после правки в разборе итог дня «${flipped}» / «${await text(`${box} [data-alert="correction"]`)}»`);
    const written = (await publicSnapshot(mock)).corrections ?? [];
    check(
      written.length === 1 && written[0].employeeId === id && written[0].kind === 'long' && written[0].date === LAST_DAY
        && written[0].delta === need && written[0].base === 0,
      `на сервере после правки в разборе: ${JSON.stringify(written)} (ждали +${need} при base 0 за ${LAST_DAY})`,
    );
    check(posts.filter((p) => p.action === 'addCorrections').length === 1, 'одно «Сохранить» — не один запрос addCorrections');
    check(!posts.some((p) => p.action === 'importFunnel'), 'правка в разборе загрузила файл');
    check((await text(cell)).includes(`правки +${need}`), `ячейка группы в разборе без отметки правки: «${await text(cell)}»`);
    check(await admin.getAttribute(`${box} [data-group-toggle="${g}"]`, 'aria-expanded') === 'true', 'после пересчёта разбора группа свернулась');
    check(
      await admin.evaluate(() => window.__confirm === document.querySelector('[data-confirm="funnel"]') && window.__confirm.isConnected && !window.__confirm.disabled),
      '«Загрузить» после правки пересоздана или недоступна',
    );

    // «Загрузить»: файл ложится, правка остаётся и не считается устаревшей
    await admin.click('[data-confirm="funnel"]');
    const done = await waitForText(admin, '[data-report="funnel"]', 'Загружено строк воронки');
    check(done.includes('Загружено строк воронки'), `загрузка из разбора: «${done}» / «${await text('[data-alert="funnel"]')}»`);
    const after = await publicSnapshot(mock);
    check(after.funnel.find((r) => r.employeeId === id && r.date === LAST_DAY)?.long === 0, 'файл из разбора не загружен');
    check(JSON.stringify(after.corrections) === JSON.stringify(written), `правка изменилась при загрузке: ${JSON.stringify(after.corrections)}`);
    await admin.click('[role="tab"][data-tab="results"]');
    await admin.waitForSelector('table.results', { timeout: 8_000 });
    check((await waitForText(admin, `[data-outcome="${g}"]`, 'Аптечка, −1 кучка')).includes('Аптечка, −1 кучка'), 'после загрузки и правки итог дня в «Итогах» не «Аптечка»');
    check(!(await text('[data-corrections] [data-correction]')).includes('⚠'), 'после загрузки правка помечена устаревшей');
  });

  await scenario('импорт воронки: устаревшая правка названа в разборе, где «из файла» взято после загрузки', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    const before = await publicSnapshot(mock);
    const person = before.staff.find((e) => e.group === 'СР2');
    const row = before.funnel.find((r) => r.employeeId === person.id && r.date === LAST_DAY);
    // счёт засчитали вручную при row.long в файле; потом пришёл новый отчёт, где уже row.long + 2
    const added = await post(mock, { action: 'addCorrections', ref: 'check-stale', items: [{ date: LAST_DAY, employeeId: person.id, kind: 'long', delta: 1, base: row.long }] });
    check(added.ok === true, `правка для проверки: ${added.error}`);
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="import"]');
    const file = xlsxFile('funnel-more.xlsx', fx.funnelXlsx([DAY_BEFORE, LAST_DAY], [{ group: person.group, people: [{ name: person.name, quality: row.quality, long: row.long + 2 }] }]));
    await admin.setInputFiles('[data-file="funnel"]', file);
    const box = '[data-report="funnel"] [data-preview="funnel"]';
    const stale = await admin.waitForSelector(`${box} [data-effects="stale"]`, { timeout: 8_000 }).then(() => true, () => false);
    check(stale, 'в разборе нет раздела об устаревших правках');
    if (!stale) return;
    const line = await textOf(admin, `${box} [data-effects="stale"]`);
    const want = `11.11, ${person.group}, ${person.name}, длинные: правка +1 сделана при ${row.long} в файле, теперь в файле ${row.long + 2} — проверьте, не пришёл ли счёт сам`;
    check(line.includes(want), `устаревшая правка в разборе: «${line}», ждали «${want}»`);
    // до загрузки правка не устарела: сервер ещё держит прежнее значение
    const serverView = (await publicSnapshot(mock)).funnel.find((r) => r.employeeId === person.id && r.date === LAST_DAY);
    check(serverView.long === row.long, 'разбор изменил воронку на сервере');
    await admin.click('[data-confirm="funnel"]');
    await waitForText(admin, '[data-report="funnel"]', 'Загружено строк воронки');
    await admin.click('[role="tab"][data-tab="results"]');
    await admin.waitForSelector('[data-correction]', { timeout: 8_000 });
    check((await textOf(admin, '[data-corrections] [data-correction]')).includes('⚠'), 'после загрузки устаревшая правка в «Итогах» не помечена');
  });

  await scenario('импорт воронки: если после правки данные не обновились, разбор и «Загрузить» закрыты до «Обновить»', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    let rereadFails = false;
    await admin.route(`${mock.url}**`, (route) => (rereadFails && route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'text/plain', body: 'timeout' })
      : route.continue()));
    const before = await publicSnapshot(mock);
    const person = before.staff.find((e) => e.group === 'СР3');
    const file = xlsxFile('funnel-one.xlsx', fx.funnelXlsx([DAY_BEFORE, LAST_DAY], [{ group: person.group, people: [{ name: person.name, quality: 3, long: 4 }] }]));
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="import"]');
    await admin.setInputFiles('[data-file="funnel"]', file);
    const box = '[data-report="funnel"] [data-preview="funnel"]';
    await admin.waitForSelector(`${box} table.results`, { timeout: 8_000 });
    await admin.click(`${box} [data-group-toggle="${person.group}"]`);
    await admin.click(`${box} button[data-correct="${person.id}"]`);
    await admin.fill(`${box} [data-edit="long"]`, '9');
    rereadFails = true;
    await admin.click(`${box} [data-save="correction"]`);
    const staleShown = await admin.waitForFunction(() => { const el = document.querySelector('[data-stale="funnel"]'); return el && !el.hidden; }, null, { timeout: 8_000 }).then(() => true, () => false);
    check(staleShown, 'после записи без перечитывания в разборе нет «Данные не обновились…»');
    check((await publicSnapshot(mock)).corrections?.length === 1, 'контроль: правка должна быть записана');
    check(await admin.evaluate(() => document.querySelector('[data-preview="funnel"] table.results').closest('[inert]') !== null), 'разбор не закрыт, пока данные не обновлены');
    check(await admin.isDisabled('[data-confirm="funnel"]'), '«Загрузить» доступна, пока данные не обновлены: загрузка — такая же запись, как правка');
    rereadFails = false;
    await admin.click('[data-refresh="funnel"]');
    const goneStale = await admin.waitForFunction(() => document.querySelector('[data-stale="funnel"]')?.hidden === true, null, { timeout: 8_000 }).then(() => true, () => false);
    check(goneStale, '«Обновить» не снял блокировку разбора');
    check((await textOf(admin, `${box} tbody[data-group="${person.group}"] tr[data-employee-row="${person.id}"]`)).includes('правки +5'), 'после «Обновить» разбор не показал правку +5 (было 4 в файле, стало 9)');
    check(await admin.evaluate(() => !document.querySelector('[data-preview="funnel"] [inert]')), 'после «Обновить» часть разбора осталась закрытой');
    check(await admin.isEnabled('[data-confirm="funnel"]'), 'после «Обновить» «Загрузить» осталась недоступной');
    await admin.click('[data-confirm="funnel"]');
    check((await waitForText(admin, '[data-report="funnel"]', 'Загружено строк воронки')).includes('Загружено строк воронки'), '«Загрузить» после сбоя чтения не сработала');
  });

  await scenario('импорт оплат: разбор до загрузки, список правок оплат за период, «Поправить»', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    const posts = trackPosts(admin);
    const before = await publicSnapshot(mock);
    const person = before.staff.find((e) => e.group === 'СР2');
    const have = before.payments.filter((p) => p.date === LAST_DAY && p.author === person.name).length;
    const added = await post(mock, { action: 'addCorrections', ref: 'check-pay', items: [{ date: LAST_DAY, employeeId: person.id, kind: 'payments', delta: 1, base: have }] });
    check(added.ok === true, `правка оплат для проверки: ${added.error}`);
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="import"]');
    const invoices = Array.from({ length: have + 3 }, (_, i) => ({ date: LAST_DAY, group: person.group, author: person.name, invoice: `FXP-${i + 1}` }));
    await admin.setInputFiles('[data-file="payments"]', xlsxFile('pay-people.xlsx', fx.paymentsXlsx(invoices)));
    const box = '[data-report="payments"] [data-preview="payments"]';
    const shown = await admin.waitForSelector(`${box} table.results`, { timeout: 8_000 }).then(() => true, () => false);
    check(shown, 'разбор оплат: нет таблицы «Итогов» до загрузки');
    if (!shown) return;
    const text = (selector) => textOf(admin, selector);
    check((await text(box)).includes('Итоги за 11.11'), 'разбор оплат: нет заголовка таблицы за последний день периода');
    check((await text(`${box} [data-effects="now"]`)).includes('Сейчас станет'), 'разбор оплат: нет «Сейчас станет»');
    check(await admin.locator(`${box} [data-effects="days"]`).count() === 0, 'разбор оплат: показаны «итоги прошлых дней», хотя оплаты оценку не меняют');
    const list = await text(`${box} [data-effects="period-corrections"]`);
    check(
      list.includes(`11.11, ${person.group}, ${person.name}, оплаты: +1`) && list.includes(`при ${have} в файле, теперь в файле ${have + 3}`),
      `список правок оплат за период: «${list}»`,
    );
    check(await admin.locator(`${box} [data-effects="stale"]`).count() === 0, 'разбор оплат: правка в списке периода названа ещё раз отдельным разделом');
    check(!posts.some((p) => p.action === 'importPayments' && p.dryRun !== true), 'разбор оплат записал данные до «Загрузить»');

    // «Поправить»: «из файла» — после загрузки (have + 3), текущее — вместе с уже сделанной правкой +1
    await admin.evaluate(() => { window.__confirm = document.querySelector('[data-confirm="payments"]'); });
    await admin.click(`${box} [data-group-toggle="${person.group}"]`);
    await admin.click(`${box} button[data-correct="${person.id}"]`);
    check(await admin.inputValue(`${box} [data-edit="payments"]`) === String(have + 4), `оплаты в редакторе разбора «${await admin.inputValue(`${box} [data-edit="payments"]`)}», ждали ${have + 4}`);
    check((await text(`${box} [data-caption="payments"]`)).trim() === `из файла ${have + 3}, правки +1`, `подпись оплат «${await text(`${box} [data-caption="payments"]`)}»`);
    await admin.fill(`${box} [data-edit="payments"]`, String(have + 6));
    await admin.click(`${box} [data-save="correction"]`);
    const grew = await waitForText(admin, `${box} [data-effects="period-corrections"]`, 'оплаты: +2');
    check(grew.includes('оплаты: +2'), `после правки в разборе оплат список периода «${grew}»`);
    const written = (await publicSnapshot(mock)).corrections ?? [];
    const mine = written.find((c) => c.delta === 2);
    check(
      written.length === 2 && mine && mine.employeeId === person.id && mine.kind === 'payments' && mine.date === LAST_DAY && mine.base === have + 3,
      `на сервере после правки в разборе оплат: ${JSON.stringify(written)}`,
    );
    check(
      await admin.evaluate(() => window.__confirm === document.querySelector('[data-confirm="payments"]') && window.__confirm.isConnected && !window.__confirm.disabled),
      '«Загрузить» оплаты после правки пересоздана или недоступна',
    );
    await admin.click('[data-confirm="payments"]');
    check((await waitForText(admin, '[data-report="payments"]', 'Загружено оплат')).includes(`Загружено оплат: ${have + 3}`), 'загрузка оплат из разбора не прошла');
    const after = await publicSnapshot(mock);
    check(after.payments.filter((p) => p.date === LAST_DAY && p.author === person.name).length === have + 3, 'оплаты сотрудника после загрузки не те');
    check((after.corrections ?? []).length === 2, 'правки изменились при загрузке оплат');
  });

  await scenario('импорт: разбор, начатый до записи правки, не берёт снимок, прочитанный до неё', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    let hold = false;
    let release = () => {};
    // следующее чтение снимка получает тело ДО записи и ждёт, пока его отпустят
    await admin.route(`${mock.url}**`, async (route) => {
      if (!hold || route.request().method() !== 'GET') return route.continue();
      hold = false;
      const response = await route.fetch();
      await new Promise((resolve) => { release = resolve; });
      return route.fulfill({ response });
    });
    const before = await publicSnapshot(mock);
    const person = before.staff.find((e) => e.group === 'СР3');
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="import"]');
    await admin.setInputFiles('[data-file="funnel"]', xlsxFile('funnel-one.xlsx', fx.funnelXlsx([DAY_BEFORE, LAST_DAY], [{ group: person.group, people: [{ name: person.name, quality: 3, long: 4 }] }])));
    const funnelBox = '[data-report="funnel"] [data-preview="funnel"]';
    await admin.waitForSelector(`${funnelBox} table.results`, { timeout: 8_000 });

    // выбран файл оплат, его чтение снимка зависло; пока оно висит, в разборе воронки записана правка
    hold = true;
    await admin.setInputFiles('[data-file="payments"]', xlsxFile('pay-one.xlsx', fx.paymentsXlsx([{ date: LAST_DAY, group: person.group, author: person.name, invoice: 'FXQ-1' }])));
    for (let i = 0; i < 50 && hold; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    check(!hold, 'контроль: чтение снимка для файла оплат не перехвачено');
    await admin.click(`${funnelBox} [data-group-toggle="${person.group}"]`);
    await admin.click(`${funnelBox} button[data-correct="${person.id}"]`);
    await admin.fill(`${funnelBox} [data-edit="long"]`, '9');
    await admin.click(`${funnelBox} [data-save="correction"]`);
    const rowText = await waitForText(admin, `${funnelBox} tr[data-employee-row="${person.id}"]`, 'правки +5');
    check(rowText.includes('правки +5'), `контроль: правка в разборе воронки не записана («${rowText}»)`);
    check((await publicSnapshot(mock)).corrections?.length === 1, 'контроль: правка должна быть на сервере');

    // чтение отпущено: разбор оплат должен показать правку, а не таблицу «до записи»
    release();
    const payBox = '[data-report="payments"] [data-preview="payments"]';
    const shown = await admin.waitForSelector(`${payBox} table.results`, { timeout: 8_000 }).then(() => true, () => false);
    check(shown, 'разбор оплат не показан');
    if (!shown) return;
    const cell = `${payBox} tbody[data-group="${person.group}"] .group-row [data-cell="day-long"]`;
    const text = await textOf(admin, cell);
    check(text.includes('правки +5'), `разбор оплат построен по снимку до записи правки, в ячейке «${text}»`);
    await admin.click(`${payBox} [data-group-toggle="${person.group}"]`);
    await admin.click(`${payBox} button[data-correct="${person.id}"]`);
    // файл воронки в этом разборе не загружается: «из файла» — значение сервера, к нему прибавлена правка +5
    const serverLong = before.funnel.find((r) => r.employeeId === person.id && r.date === LAST_DAY).long;
    check(await admin.inputValue(`${payBox} [data-edit="long"]`) === String(serverLong + 5), `в редакторе разбора оплат длинные «${await admin.inputValue(`${payBox} [data-edit="long"]`)}», ждали ${serverLong + 5} (на сервере ${serverLong} и правка +5)`);
  });

  // Загрузка файла — такая же запись, как правка: второй разбор после неё пересчитывается по снимку, прочитанному ПОСЛЕ загрузки
  const invoicesOf = (snapshot, name, date) => snapshot.payments.filter((p) => p.date === date && p.author === name).length;
  const bothPreviews = async (admin, funnelPeople, invoices, group) => {
    await admin.click('[role="tab"][data-tab="import"]');
    await admin.setInputFiles('[data-file="funnel"]', xlsxFile('funnel-r1.xlsx', fx.funnelXlsx([DAY_BEFORE, LAST_DAY], [{ group, people: funnelPeople }])));
    await admin.waitForSelector('[data-report="funnel"] [data-preview="funnel"] table.results', { timeout: 8_000 });
    await admin.setInputFiles('[data-file="payments"]', xlsxFile('pay-r1.xlsx', fx.paymentsXlsx(invoices)));
    await admin.waitForSelector('[data-report="payments"] [data-preview="payments"] table.results', { timeout: 8_000 });
  };
  const FBOX = '[data-report="funnel"] [data-preview="funnel"]';
  const PBOX = '[data-report="payments"] [data-preview="payments"]';

  await scenario('импорт: «Загрузить» оплаты — разбор воронки пересчитан, «Поправить» оплаты идёт от значений после неё', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    const before = await publicSnapshot(mock);
    const person = before.staff.find((e) => e.group === 'СР2');
    const have = invoicesOf(before, person.name, LAST_DAY);
    await loginAdmin(admin, urls.admin);
    const invoices = Array.from({ length: have + 2 }, (_, i) => ({ date: LAST_DAY, group: person.group, author: person.name, invoice: `FXR-${i + 1}` }));
    await bothPreviews(admin, [{ name: person.name, quality: 3, long: 4 }], invoices, person.group);
    await admin.click(`${FBOX} [data-group-toggle="${person.group}"]`);
    await admin.click(`${FBOX} button[data-correct="${person.id}"]`);
    check(await admin.inputValue(`${FBOX} [data-edit="payments"]`) === String(have), `до загрузки оплат в разборе воронки оплаты сотрудника «${await admin.inputValue(`${FBOX} [data-edit="payments"]`)}», на сервере ${have}`);
    await admin.click(`${FBOX} [data-cancel="correction"]`);

    await admin.click('[data-confirm="payments"]');
    check((await waitForText(admin, '[data-report="payments"]', 'Загружено оплат')).includes(`Загружено оплат: ${have + 2}`), 'загрузка оплат не прошла');
    check(invoicesOf(await publicSnapshot(mock), person.name, LAST_DAY) === have + 2, 'контроль: оплаты на сервере не обновились');
    // разбор воронки уже пересчитан по снимку после загрузки: в нём новые оплаты, а не старые
    await admin.click(`${FBOX} button[data-correct="${person.id}"]`);
    const shown = await admin.inputValue(`${FBOX} [data-edit="payments"]`);
    check(shown === String(have + 2), `после загрузки оплат в разборе воронки «${shown}», на сервере уже ${have + 2}`);
    check((await textOf(admin, `${FBOX} [data-caption="payments"]`)).trim() === `из файла ${have + 2}`, `подпись оплат в разборе воронки «${await textOf(admin, `${FBOX} [data-caption="payments"]`)}»`);
    await admin.fill(`${FBOX} [data-edit="payments"]`, String(have + 3));
    await admin.click(`${FBOX} [data-save="correction"]`);
    await waitForText(admin, '[data-status="funnel-preview"]', 'Правка сохранена');
    const written = (await publicSnapshot(mock)).corrections ?? [];
    check(
      written.length === 1 && written[0].kind === 'payments' && written[0].employeeId === person.id && written[0].date === LAST_DAY
        && written[0].delta === 1 && written[0].base === have + 2,
      `на сервере после правки оплат в разборе воронки: ${JSON.stringify(written)} (ждали +1 при base ${have + 2})`,
    );
    const final = await publicSnapshot(mock);
    const total = invoicesOf(final, person.name, LAST_DAY) + final.corrections.reduce((sum, c) => sum + c.delta, 0);
    check(total === have + 3, `у сотрудника оплат ${total}, набрано в редакторе ${have + 3}`);
    check(await admin.isEnabled('[data-confirm="funnel"]'), '«Загрузить» воронку после правки недоступна');
  });

  await scenario('импорт: «Загрузить» воронку — разбор оплат пересчитан, «Поправить» воронку идёт от значений после неё', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    const before = await publicSnapshot(mock);
    const person = before.staff.find((e) => e.group === 'СР2');
    const serverLong = before.funnel.find((r) => r.employeeId === person.id && r.date === LAST_DAY)?.long ?? 0;
    check(serverLong !== 4, 'контроль: на сервере длинные уже 4, проверка ничего не докажет');
    await loginAdmin(admin, urls.admin);
    await bothPreviews(admin, [{ name: person.name, quality: 3, long: 4 }], [{ date: LAST_DAY, group: person.group, author: person.name, invoice: 'FXS-1' }], person.group);
    await admin.click('[data-confirm="funnel"]');
    check((await waitForText(admin, '[data-report="funnel"]', 'Загружено строк воронки')).includes('Загружено строк воронки'), 'загрузка воронки не прошла');
    await admin.click(`${PBOX} [data-group-toggle="${person.group}"]`);
    await admin.click(`${PBOX} button[data-correct="${person.id}"]`);
    const shown = await admin.inputValue(`${PBOX} [data-edit="long"]`);
    check(shown === '4', `после загрузки воронки в разборе оплат длинные «${shown}», на сервере уже 4 (было ${serverLong})`);
    check((await textOf(admin, `${PBOX} [data-caption="long"]`)).trim() === 'из файла 4', `подпись длинных в разборе оплат «${await textOf(admin, `${PBOX} [data-caption="long"]`)}»`);
    await admin.fill(`${PBOX} [data-edit="long"]`, '6');
    await admin.click(`${PBOX} [data-save="correction"]`);
    await waitForText(admin, '[data-status="payments-preview"]', 'Правка сохранена');
    const written = (await publicSnapshot(mock)).corrections ?? [];
    check(
      written.length === 1 && written[0].kind === 'long' && written[0].delta === 2 && written[0].base === 4 && written[0].date === LAST_DAY,
      `на сервере после правки в разборе оплат: ${JSON.stringify(written)} (ждали +2 при base 4)`,
    );
    check(await admin.isEnabled('[data-confirm="payments"]'), '«Загрузить» оплаты после правки недоступна');
  });

  await scenario('импорт: разбор, начатый до загрузки другого файла, не берёт снимок, прочитанный до неё', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    let hold = false;
    let release = () => {};
    await admin.route(`${mock.url}**`, async (route) => {
      if (!hold || route.request().method() !== 'GET') return route.continue();
      hold = false;
      const response = await route.fetch(); // тело до загрузки воронки
      await new Promise((resolve) => { release = resolve; });
      return route.fulfill({ response });
    });
    const before = await publicSnapshot(mock);
    const person = before.staff.find((e) => e.group === 'СР2');
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="import"]');
    await admin.setInputFiles('[data-file="funnel"]', xlsxFile('funnel-r1.xlsx', fx.funnelXlsx([DAY_BEFORE, LAST_DAY], [{ group: person.group, people: [{ name: person.name, quality: 3, long: 4 }] }])));
    await admin.waitForSelector(`${FBOX} table.results`, { timeout: 8_000 });
    hold = true;
    await admin.setInputFiles('[data-file="payments"]', xlsxFile('pay-r1.xlsx', fx.paymentsXlsx([{ date: LAST_DAY, group: person.group, author: person.name, invoice: 'FXT-1' }])));
    for (let i = 0; i < 50 && hold; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    check(!hold, 'контроль: чтение снимка для файла оплат не перехвачено');
    await admin.click('[data-confirm="funnel"]');
    check((await waitForText(admin, '[data-report="funnel"]', 'Загружено строк воронки')).includes('Загружено строк воронки'), 'загрузка воронки не прошла');
    release();
    const shown = await admin.waitForSelector(`${PBOX} table.results`, { timeout: 8_000 }).then(() => true, () => false);
    check(shown, 'разбор оплат не показан');
    if (!shown) return;
    await admin.click(`${PBOX} [data-group-toggle="${person.group}"]`);
    await admin.click(`${PBOX} button[data-correct="${person.id}"]`);
    const value = await admin.inputValue(`${PBOX} [data-edit="long"]`);
    check(value === '4', `разбор оплат построен по снимку до загрузки воронки: длинные «${value}», на сервере уже 4`);
  });

  await scenario('импорт: пока пишется правка, обе «Загрузить» недоступны', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    let hold = false;
    let release = () => {};
    await admin.route(`${mock.url}**`, async (route) => {
      const request = route.request();
      if (!hold || request.method() !== 'POST' || JSON.parse(request.postData() ?? '{}').action !== 'addCorrections') return route.continue();
      hold = false;
      await new Promise((resolve) => { release = resolve; });
      return route.continue();
    });
    const before = await publicSnapshot(mock);
    const person = before.staff.find((e) => e.group === 'СР3');
    await loginAdmin(admin, urls.admin);
    await bothPreviews(admin, [{ name: person.name, quality: 3, long: 4 }], [{ date: LAST_DAY, group: person.group, author: person.name, invoice: 'FXU-1' }], person.group);
    check(await admin.isEnabled('[data-confirm="funnel"]') && await admin.isEnabled('[data-confirm="payments"]'), 'контроль: до записи кнопки «Загрузить» недоступны');
    await admin.click(`${FBOX} [data-group-toggle="${person.group}"]`);
    await admin.click(`${FBOX} button[data-correct="${person.id}"]`);
    await admin.fill(`${FBOX} [data-edit="long"]`, '9');
    hold = true;
    await admin.click(`${FBOX} [data-save="correction"]`);
    const locked = await admin.waitForFunction(() => document.querySelector('[data-confirm="funnel"]')?.disabled && document.querySelector('[data-confirm="payments"]')?.disabled, null, { timeout: 5_000 }).then(() => true, () => false);
    check(locked, 'пока пишется правка, «Загрузить» воронку и оплаты доступны');
    release();
    const unlocked = await admin.waitForFunction(() => !document.querySelector('[data-confirm="funnel"]')?.disabled && !document.querySelector('[data-confirm="payments"]')?.disabled, null, { timeout: 8_000 }).then(() => true, () => false);
    check(unlocked, 'после записи правки «Загрузить» осталась недоступной');
    await admin.click('[data-confirm="payments"]');
    check((await waitForText(admin, '[data-report="payments"]', 'Загружено оплат')).includes('Загружено оплат'), 'после записи правки загрузка оплат не прошла');
  });

  // Загрузка без ответа (обрыв, таймаут): сервер мог её не принять или ещё дописывать, а чтение этого не покажет.
  // Поток «устарел» с особым текстом, правки отклонены, снимается только повтором загрузки того же блока.
  const UNRESOLVED = 'Связь прервалась во время загрузки — нажмите «Загрузить» ещё раз (повторная загрузка того же файла безопасна).';
  const inertAt = (admin, selector) => admin.$eval(selector, (el) => el.closest('[inert]') !== null).catch(() => false);
  const visibleStale = (admin, id) => admin.waitForFunction((sel) => { const el = document.querySelector(sel); return el && !el.hidden; }, id === true ? '[data-stale]' : `[data-stale="${id}"]`, { timeout: 8_000 }).then(() => true, () => false);

  await scenario('импорт: ответ на загрузку оплат потерян — разбор и «Итоги» закрыты, «Загрузить» воронки недоступна, закрывает только повтор', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    let lose = false;
    // ответ потерян, а запись на сервер ещё не дошла (дописывается): чтение сейчас покажет данные ДО загрузки
    await admin.route(`${mock.url}**`, async (route) => {
      const request = route.request();
      const body = request.method() === 'POST' ? JSON.parse(request.postData() ?? '{}') : {};
      if (lose && body.action === 'importPayments' && !body.dryRun) {
        lose = false;
        return route.fulfill({ status: 200, contentType: 'text/plain', body: 'timeout' });
      }
      return route.continue();
    });
    const before = await publicSnapshot(mock);
    const person = before.staff.find((e) => e.group === 'СР2');
    const have = invoicesOf(before, person.name, LAST_DAY);
    await loginAdmin(admin, urls.admin);
    const invoices = Array.from({ length: have + 2 }, (_, i) => ({ date: LAST_DAY, group: person.group, author: person.name, invoice: `FXL-${i + 1}` }));
    await bothPreviews(admin, [{ name: person.name, quality: 3, long: 4 }], invoices, person.group);
    lose = true;
    await admin.click('[data-confirm="payments"]');
    check((await waitForText(admin, '[data-alert="payments"]', 'Связь прервалась')).includes(UNRESOLVED), `сообщение о потерянной загрузке: «${await textOf(admin, '[data-alert="payments"]')}»`);
    check(invoicesOf(await publicSnapshot(mock), person.name, LAST_DAY) === have, 'контроль: запись дошла до сервера, проверка ничего не докажет');
    check(await visibleStale(admin, 'funnel') && await visibleStale(admin, 'payments'), 'после потерянной загрузки разборы не «устарели»');
    check((await textOf(admin, '[data-stale="funnel"]')).includes(UNRESOLVED), `текст в разборе воронки: «${await textOf(admin, '[data-stale="funnel"]')}»`);
    check(await admin.isHidden('[data-refresh="funnel"]') && await admin.isHidden('[data-refresh="payments"]'), '«Обновить» осталась при потерянной загрузке: она ничего не снимает');
    check(await inertAt(admin, `${FBOX} [data-group-toggle="${person.group}"]`), 'разбор воронки не закрыт');
    check(await admin.isDisabled('[data-confirm="funnel"]'), '«Загрузить» воронку доступна, пока не подтверждена загрузка оплат');
    check(await admin.isEnabled('[data-confirm="payments"]'), '«Загрузить» оплаты (повтор) недоступна');

    // состояние на всю страницу: «Итоги» тоже закрыты, смена вкладки его не снимает
    await admin.click('[role="tab"][data-tab="results"]');
    check(await visibleStale(admin, true), 'в «Итогах» нет сообщения «устарело»');
    check((await textOf(admin, '[data-stale]')).includes(UNRESOLVED), `текст в «Итогах»: «${await textOf(admin, '[data-stale]')}»`);
    check(await admin.isHidden('[data-refresh]'), 'в «Итогах» осталась «Обновить»');
    check(await inertAt(admin, 'table.results'), 'таблица «Итогов» не закрыта');
    await admin.click('[role="tab"][data-tab="import"]');
    check((await waitForText(admin, '[data-alert="import-open"]', 'Связь прервалась')).includes(UNRESOLVED), 'на возврате во вкладку нет сообщения о потерянной загрузке');
    await bothPreviews(admin, [{ name: person.name, quality: 3, long: 4 }], invoices, person.group);
    check(await visibleStale(admin, 'payments') && await visibleStale(admin, 'funnel'), 'новые разборы открылись не «устаревшими»');
    check(await admin.isEnabled('[data-confirm="payments"]') && await admin.isDisabled('[data-confirm="funnel"]'), 'после возврата во вкладку доступна не та «Загрузить»');

    await admin.click('[data-confirm="payments"]');
    check((await waitForText(admin, '[data-report="payments"]', 'Загружено оплат')).includes(`Загружено оплат: ${have + 2}`), 'повторная загрузка оплат не прошла');
    check(invoicesOf(await publicSnapshot(mock), person.name, LAST_DAY) === have + 2, 'после повтора оплаты на сервере не те');
    const open = await admin.waitForFunction(() => document.querySelector('[data-stale="funnel"]')?.hidden === true, null, { timeout: 8_000 }).then(() => true, () => false);
    check(open, 'после повторной загрузки разбор воронки остался «устаревшим»');
    // разбор воронки построен по снимку ПОСЛЕ загрузки, а «Поправить» идёт от значений после неё
    await admin.click(`${FBOX} [data-group-toggle="${person.group}"]`);
    await admin.click(`${FBOX} button[data-correct="${person.id}"]`);
    const shown = await admin.inputValue(`${FBOX} [data-edit="payments"]`);
    check(shown === String(have + 2), `после повтора в разборе воронки оплаты «${shown}», на сервере ${have + 2}`);
    await admin.fill(`${FBOX} [data-edit="payments"]`, String(have + 3));
    await admin.click(`${FBOX} [data-save="correction"]`);
    await waitForText(admin, '[data-status="funnel-preview"]', 'Правка сохранена');
    const written = (await publicSnapshot(mock)).corrections ?? [];
    check(written.length === 1 && written[0].delta === 1 && written[0].base === have + 2, `правка после повтора: ${JSON.stringify(written)} (ждали +1 при base ${have + 2})`);
    await admin.click('[role="tab"][data-tab="results"]');
    check(await admin.waitForFunction(() => document.querySelector('[data-stale]')?.hidden === true, null, { timeout: 8_000 }).then(() => true, () => false), '«Итоги» после повтора остались «устаревшими»');
  });

  await scenario('импорт: ответ на загрузку воронки потерян после записи — «Загрузить» оплаты недоступна, повтор ничего не удваивает', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    let lose = false;
    // запись дошла, а ответ нет: повтор того же файла обязан быть безопасным
    await admin.route(`${mock.url}**`, async (route) => {
      const request = route.request();
      const body = request.method() === 'POST' ? JSON.parse(request.postData() ?? '{}') : {};
      if (lose && body.action === 'importFunnel') {
        lose = false;
        await route.fetch();
        return route.fulfill({ status: 200, contentType: 'text/plain', body: 'timeout' });
      }
      return route.continue();
    });
    const before = await publicSnapshot(mock);
    const person = before.staff.find((e) => e.group === 'СР2');
    await loginAdmin(admin, urls.admin);
    await bothPreviews(admin, [{ name: person.name, quality: 3, long: 4 }], [{ date: LAST_DAY, group: person.group, author: person.name, invoice: 'FXM-1' }], person.group);
    const rowsOf = (s) => s.funnel.filter((r) => r.employeeId === person.id && r.date === LAST_DAY);
    lose = true;
    await admin.click('[data-confirm="funnel"]');
    check((await waitForText(admin, '[data-alert="funnel"]', 'Связь прервалась')).includes(UNRESOLVED), `сообщение о потерянной загрузке: «${await textOf(admin, '[data-alert="funnel"]')}»`);
    check(rowsOf(await publicSnapshot(mock)).length === 1 && rowsOf(await publicSnapshot(mock))[0].long === 4, 'контроль: запись воронки не дошла до сервера');
    check(await visibleStale(admin, 'payments'), 'разбор оплат после потерянной загрузки воронки не «устарел»');
    check((await textOf(admin, '[data-stale="payments"]')).includes(UNRESOLVED), 'нет текста о потерянной загрузке в разборе оплат');
    check(await admin.isDisabled('[data-confirm]:not([data-confirm="funnel"])') && await admin.isEnabled('[data-confirm="funnel"]'), 'доступна не та «Загрузить»: повторить можно только воронку');
    await admin.click('[data-confirm="funnel"]');
    check((await waitForText(admin, '[data-report="funnel"]', 'Загружено строк воронки')).includes('Загружено строк воронки'), 'повторная загрузка воронки не прошла');
    const both = await admin.waitForFunction(() => document.querySelector('[data-stale="payments"]')?.hidden === true && !document.querySelector('[data-confirm="payments"]')?.disabled, null, { timeout: 8_000 }).then(() => true, () => false);
    check(both, 'после повтора разбор оплат остался «устаревшим» или «Загрузить» оплаты недоступна');
    check(rowsOf(await publicSnapshot(mock)).length === 1 && rowsOf(await publicSnapshot(mock))[0].long === 4, 'повтор удвоил или потерял строку воронки');
    await admin.click(`${PBOX} [data-group-toggle="${person.group}"]`);
    await admin.click(`${PBOX} button[data-correct="${person.id}"]`);
    const shown = await admin.inputValue(`${PBOX} [data-edit="long"]`);
    check(shown === '4', `после повтора в разборе оплат длинные «${shown}», на сервере 4`);
  });

  await scenario('импорт: не тот файл', async ({ newPage, check, urls }) => {
    const admin = await newPage();
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="import"]');
    const funnel = xlsxFile('funnel.xlsx', fx.funnelXlsx(['2026-11-10', '2026-11-11'], [{ group: 'СР1', people: [{ name: 'Тест Один', quality: 1, long: 1 }] }]));
    const payments = xlsxFile('pay.xlsx', fx.paymentsXlsx([{ date: '2026-11-11', group: 'СР1', author: 'Тест Один', invoice: 'FX-1' }]));
    await admin.setInputFiles('[data-file="payments"]', funnel);
    const a = await waitForText(admin, '[data-alert="payments"]', 'Не тот файл');
    check(a.includes('Не тот файл') && a.includes('№ счета'), `воронка в «Оплатах»: «${a}»`);
    check(await admin.locator('[data-confirm]').count() === 0, 'воронка в «Оплатах»: есть кнопка загрузки');
    await admin.setInputFiles('[data-file="funnel"]', payments);
    const b = await waitForText(admin, '[data-alert="funnel"]', 'Не тот файл');
    check(b.includes('Не тот файл'), `оплаты в «Воронке»: «${b}»`);
    check(await admin.locator('[data-confirm]').count() === 0, 'оплаты в «Воронке»: есть кнопка загрузки');
  });

  await scenario('сотрудники: отпуск задним числом', async ({ mock, newPage, check, urls }) => {
    // кто из СР1 (не отпускник мока) платил и в какой день: берём самый поздний такой день до 10.11
    const snap = await publicSnapshot(mock);
    const byName = new Map(snap.staff.map((e) => [e.name, e]));
    const hit = snap.payments
      .filter((p) => p.group === 'СР1' && p.author !== MOCK_VACATIONER && byName.has(p.author) && p.date > '2026-11-02' && p.date <= '2026-11-10')
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    check(Boolean(hit), 'в моке нет оплат СР1 для сценария');
    if (!hit) return;
    const worker = byName.get(hit.author);
    const day = hit.date;
    const paidThatDay = snap.payments.filter((p) => p.group === 'СР1' && p.author === hit.author && p.date === day).length;
    const dayBefore = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const dates = { before: dayBefore, day, today: '2026-11-12' };

    // панель «Группа» (СР1 по умолчанию, накопительно) на дату: сотрудник → число оплат
    const screen = await newPage();
    const groupAt = async (asOf) => {
      const url = new URL(urls.screen);
      url.searchParams.set('asOf', asOf);
      await screen.goto(url.href, { waitUntil: 'networkidle' });
      await screen.waitForSelector('[data-block="group"] tbody tr[data-employee]', { timeout: 8_000 });
      return screen.$$eval('[data-block="group"] tbody tr[data-employee]', (trs) =>
        Object.fromEntries(trs.map((tr) => [tr.dataset.employee, parseInt(tr.querySelector('.value')?.textContent ?? '', 10)])));
    };
    const read = async () => ({ before: await groupAt(dates.before), day: await groupAt(dates.day), today: await groupAt(dates.today) });
    const was = await read();
    check(was.today[worker.id] >= paidThatDay && paidThatDay > 0, 'контроль: у сотрудника нет оплат в выбранный день');
    check(worker.id in was.day, 'контроль: сотрудник не виден в рейтинге в день отпуска до отпуска');

    const admin = await newPage();
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="staff"]');
    await admin.waitForSelector(`button[data-employee="${worker.id}"]`, { timeout: 8_000 });
    await admin.click(`button[data-employee="${worker.id}"]`);
    await admin.selectOption('[data-field="absenceKind"]', 'vacation');
    await admin.fill('[data-field="absenceFrom"]', day);
    await admin.fill('[data-field="absenceTo"]', day);
    await admin.click('[data-add="absence"]');
    const saved = await waitForText(admin, '[data-status="staff-form"]', 'Сохранено');
    check(saved.includes('Сохранено'), `отпуск не сохранён: «${saved}» / «${await textOf(admin, '[data-alert="staff-form"]')}»`);
    check((await textOf(admin, '[data-absences]')).includes(`${day.slice(8)}.${day.slice(5, 7)}.${day.slice(0, 4)}`), 'в карточке не видно добавленного отпуска');
    check((await publicSnapshot(mock)).absences.some((a) => a.employeeId === worker.id && a.kind === 'vacation' && a.from === day && a.to === day), 'отпуск не записан на сервер');

    const now = await read();
    check(JSON.stringify(now.before) === JSON.stringify(was.before), `день до отпуска изменился: ${JSON.stringify(now.before)} ≠ ${JSON.stringify(was.before)}`);
    check(!(worker.id in now.day), 'в день отпуска сотрудник остался в рейтинге группы');
    const { [worker.id]: removed, ...restWas } = was.day;
    check(JSON.stringify(now.day) === JSON.stringify(restWas) && removed !== undefined, 'в день отпуска изменились очки других сотрудников');
    check(now.today[worker.id] === was.today[worker.id] - paidThatDay, `накопительно к 12.11: ${now.today[worker.id]}, ожидалось ${was.today[worker.id] - paidThatDay}`);
    for (const [id, value] of Object.entries(was.today)) {
      if (id !== worker.id) check(now.today[id] === value, 'к 12.11 изменились очки другого сотрудника');
    }
  });

  await scenario('сотрудники: карточка, отсутствия, JSON', async ({ mock, newPage, check, urls }) => {
    const snap0 = await publicSnapshot(mock);
    const total = snap0.staff.length;
    const staffNow = async () => (await publicSnapshot(mock)).staff;
    const person = async (id) => (await staffNow()).find((e) => e.id === id);
    const target = snap0.staff.find((e) => e.group === 'СР2');
    const reason = 'декрет-проба';

    const admin = await newPage();
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="staff"]');
    check((await waitForText(admin, '[data-staff-count]', 'Найдено')).includes(`Найдено: ${total} из ${total}`), 'без запроса в списке не весь штат');

    // поиск без регистра
    await admin.fill('[data-staff-search]', target.name.toLowerCase());
    const found = Number((await textOf(admin, '[data-staff-count]')).match(/Найдено: (\d+)/)?.[1]);
    check(found >= 1 && found < total, `поиск: найдено ${found} из ${total}`);
    check(await admin.locator(`button[data-employee="${target.id}"]`).count() === 1, 'поиск не нашёл сотрудника по ФИО в нижнем регистре');
    await admin.click(`button[data-employee="${target.id}"]`);
    const status = () => textOf(admin, '[data-status="staff-form"]');
    const alert = () => textOf(admin, '[data-alert="staff-form"]');
    const save = async () => {
      await admin.click('[data-save="staff"]');
      await admin.waitForFunction(() => document.querySelector('[data-status="staff-form"]')?.textContent?.includes('Сохранено') || document.querySelector('[data-alert="staff-form"]')?.textContent, null, { timeout: 8_000 }).catch(() => {});
    };

    // недописанная дата увольнения (одна цифра дня): форму держит сам браузер, пустое value не уходит как «не уволен»
    const fireWas = (await person(target.id)).fireDate ?? null;
    await admin.click('[data-field="fireDate"]');
    await admin.keyboard.type('1');
    check(await admin.$eval('[data-field="fireDate"]', (i) => i.validity.badInput), 'карточка: цифра не сделала дату недописанной');
    check(await admin.$eval('form[data-form="staff"]', (f) => !f.checkValidity()), 'карточка: форма с недописанной датой считается заполненной');
    await admin.click('[data-save="staff"]');
    await admin.waitForTimeout(1_000);
    check(((await person(target.id)).fireDate ?? null) === fireWas, 'карточка: недописанная дата дошла до сервера');
    await admin.fill('[data-field="fireDate"]', '');

    // исключение из рейтинга: без причины сервер не вызывается, с причиной — флаг на сервере, причина только у админа
    await admin.check('[data-field="hiddenFromRating"]');
    await save();
    check((await alert()).includes('причин'), `скрытие без причины: «${await alert()}»`);
    check((await person(target.id)).hiddenFromRating === false, 'скрытие без причины дошло до сервера');
    await admin.fill('[data-field="hiddenReason"]', reason);
    await save();
    check((await status()).includes('Сохранено'), `скрытие с причиной: «${await alert()}»`);
    check((await person(target.id)).hiddenFromRating === true, 'флаг исключения из рейтинга не записан');
    check(!JSON.stringify(await publicSnapshot(mock)).includes(reason), 'причина исключения попала в публичный снимок');
    check(await admin.inputValue('[data-field="hiddenReason"]') === reason, 'после записи причина не подгрузилась из getPrivate');

    // увольнение и его отмена
    await admin.fill('[data-field="fireDate"]', '2026-11-13');
    await save();
    check((await person(target.id)).fireDate === '2026-11-13', 'увольнение не записано');
    await admin.fill('[data-field="fireDate"]', '');
    await save();
    check((await person(target.id)).fireDate === null, 'отмена увольнения не записана');

    // перевод с будущей даты: сегодня сотрудник ещё в прежней группе
    await admin.fill('[data-field="transferDate"]', '2026-11-16');
    await admin.selectOption('[data-field="transferGroup"]', 'СР3');
    await save();
    check(JSON.stringify((await person(target.id)).transfers) === JSON.stringify([{ date: '2026-11-16', group: 'СР3' }]), 'перевод не записан');
    check((await textOf(admin, '[data-staff-card]')).includes('16.11.2026'), 'в карточке не виден перевод');
    check((await textOf(admin, `button[data-employee="${target.id}"]`)).endsWith('СР2'), 'до даты перевода сотрудник должен числиться в прежней группе');

    // без изменений — сообщение, а не пустая запись
    await save();
    check((await alert()).includes('Ничего не изменено'), `повторное сохранение без изменений: «${await alert()}»`);

    // снять отпуск отпускника мока
    await admin.fill('[data-staff-search]', '');
    const vacationer = snap0.staff.find((e) => e.name === MOCK_VACATIONER);
    await admin.click(`button[data-employee="${vacationer.id}"]`);
    check(await admin.locator('[data-absences] li').count() === 1, 'у отпускника мока в карточке не одно отсутствие');
    await admin.click('[data-remove="2026-11-11"]');
    await admin.waitForFunction(() => document.querySelectorAll('[data-absences] li').length === 0, null, { timeout: 8_000 }).catch(() => {});
    check(!(await publicSnapshot(mock)).absences.some((a) => a.employeeId === vacationer.id), 'отпуск не снят на сервере');

    // загрузка списка из JSON: превью без записи, потом подтверждение
    const existing = snap0.staff.find((e) => e.group === 'СР5');
    const jsonFile = (items) => ({ name: 'staff.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(items)) });
    await admin.setInputFiles('[data-file="staff"]', jsonFile([
      { name: 'Тест Json Новый', group: 'СР2', hireDate: '2026-11-09' },
      { name: existing.name, group: 'СР5', baseLevel: 'rookie1' },
    ]));
    const preview = await waitForText(admin, '[data-report="staff"]', 'Записей: 2');
    check(preview.includes('новых: 1; обновится: 1'), `превью списка: «${preview}»`);
    check(!preview.includes('Тест'), 'в превью списка есть ФИО');
    check((await staffNow()).length === total, 'превью записало штат до подтверждения');
    await admin.click('[data-confirm="staff"]');
    const done = await waitForText(admin, '[data-report="staff"]', 'Добавлено');
    check(done.includes('Добавлено: 1; обновлено: 1.'), `итог загрузки списка: «${done}»`);
    const after = await staffNow();
    check(after.length === total + 1 && after.some((e) => e.name === 'Тест Json Новый' && e.group === 'СР2' && e.hireDate === '2026-11-09'), 'новый сотрудник из списка не добавлен');
    check(after.find((e) => e.id === existing.id)?.baseLevel === 'rookie1', 'уровень существующего сотрудника не обновлён');
    check((await textOf(admin, '[data-staff-count]')).includes(`Найдено: ${total + 1} из ${total + 1}`), 'после загрузки список штата не обновился');

    // плохой список: ошибка с номером записи, без ФИО, без кнопки
    await admin.setInputFiles('[data-file="staff"]', jsonFile([
      { name: 'Тест Дубль', group: 'СР1' },
      { name: 'тест  дубль', group: 'СР2' },
    ]));
    const bad = await waitForText(admin, '[data-report="staff"]', 'Запись 2');
    check(bad.includes('Запись 2') && !bad.includes('Тест') && !bad.includes('тест'), `ошибка списка: «${bad}»`);
    check(await admin.locator('[data-confirm="staff"]').count() === 0, 'у плохого списка есть кнопка загрузки');
    check((await staffNow()).length === total + 1, 'плохой список изменил штат');
  });

  await scenario('нормы: качественные опытных → экран', async ({ mock, newPage, check, urls }) => {
    const screen = await newPage();
    // отпечаток всех питомцев экрана: стадия, настроение, кучки, запасы
    await screen.addInitScript(() => {
      window.__sig = () => [...document.querySelectorAll('[data-group]')].map((e) => [
        e.dataset.group, e.dataset.stage, e.dataset.mood, e.dataset.piles,
        e.querySelector('[data-count="toys"]')?.textContent, e.querySelector('[data-count="medkits"]')?.textContent,
      ].join('|')).join(';');
    });
    await screen.goto(urls.screen, { waitUntil: 'networkidle' });
    await screen.waitForSelector('[data-group="СР6"] .sub', { timeout: 8_000 });
    const before = await screen.evaluate(() => window.__sig());
    const configBefore = (await publicSnapshot(mock)).config;

    const admin = await newPage();
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="norms"]');
    await admin.waitForSelector('[data-field="norm-experienced-quality"]', { timeout: 8_000 });
    const field = (name) => admin.inputValue(`[data-field="${name}"]`);
    check(await field('norm-experienced-quality') === '5' && await field('norm-rookie1-quality') === '1', 'нормы не предзаполнены текущими значениями');
    check(await field('maxPiles') === '5' && await field('threshold-1') === '25', 'пороги не предзаполнены текущими значениями');
    check(await admin.locator('[data-field^="threshold-"]').count() === 4, 'порогов стадий не 4');
    check(await field('norm-experienced-payments') === '0,4', `норма оплат опытных не предзаполнена: «${await field('norm-experienced-payments')}»`);
    for (const f of ['quality', 'long', 'payments']) {
      check(await admin.getAttribute(`[data-field="norm-experienced-${f}"]`, 'inputmode') === 'decimal', `у нормы «${f}» нет дробной клавиатуры`);
    }

    // факты мока ровно равны норме опытных, поэтому смену видно только при повышении нормы: игрушки перестают копиться
    await admin.fill('[data-field="norm-experienced-quality"]', '50');
    await admin.fill('[data-field="norm-experienced-payments"]', '0,5'); // с запятой, как пишут по-русски
    await admin.fill('[data-field="norm-rookie2-long"]', '1,5'); // дробная норма длинных
    const v0 = (await publicSnapshot(mock)).version;
    await admin.click('[data-save="config"]');
    // правка переписывает всю историю: сначала предпросмотр «было → станет», на сервер пока ничего не уходит
    const preview = await waitForText(admin, '[data-preview="config"]', 'истори');
    check(preview.includes('истори') && preview.includes('→'), `нет предпросмотра с последствиями: «${preview}»`);
    check((await publicSnapshot(mock)).version === v0, 'правка записана до подтверждения');
    await admin.click('[data-cancel="config"]');
    check(await admin.locator('[data-preview="config"]').count() === 0 && await field('norm-experienced-quality') === '50', 'отмена не убрала предпросмотр или потеряла введённое');
    check((await publicSnapshot(mock)).version === v0, 'отмена записала правку');
    await admin.click('[data-save="config"]');
    await admin.waitForSelector('[data-confirm="config"]', { timeout: 8_000 });
    await admin.click('[data-confirm="config"]');
    check((await waitForText(admin, '[data-status="config"]', 'Сохранено')).includes('Сохранено'), `норма не сохранена: «${await textOf(admin, '[data-alert="config"]')}»`);
    const config = (await publicSnapshot(mock)).config;
    check(config.norms?.experienced?.quality === 50, 'норма опытных не записана на сервер');
    check(config.norms?.experienced?.payments === 0.5, `норма оплат опытных не записана: ${config.norms?.experienced?.payments}`);
    check(config.norms?.experienced?.long === configBefore.norms?.experienced?.long && config.maxPiles === configBefore.maxPiles, 'на сервер ушло неизменённое');
    check(config.norms?.rookie2?.long === 1.5, `дробная норма длинных не записана: ${config.norms?.rookie2?.long}`);
    check(await field('norm-experienced-quality') === '50' && await field('norm-rookie2-long') === '1,5', 'после записи форма не перечитана');

    await screen.waitForFunction((old) => window.__sig() !== old, before, { timeout: 8_000 }).catch(() => {});
    check(await screen.evaluate(() => window.__sig()) !== before, 'экран не пересчитал питомцев после смены нормы за время опроса');
  });

  await scenario('нормы: плохие значения', async ({ mock, newPage, check, urls }) => {
    const version = async () => (await publicSnapshot(mock)).version;
    const v0 = await version();
    const admin = await newPage();
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="norms"]');
    await admin.waitForSelector('[data-field="maxPiles"]', { timeout: 8_000 });
    const alert = () => textOf(admin, '[data-alert="config"]');
    const status = () => textOf(admin, '[data-status="config"]');
    const save = async () => {
      await admin.click('[data-save="config"]');
      const outcome = '[data-alert="config"]:not(:empty), [data-status="config"]:not(:empty)';
      await admin.waitForSelector(`${outcome}, [data-confirm="config"]`, { timeout: 8_000 }).catch(() => {});
      if (await admin.locator('[data-confirm="config"]').count()) {
        await admin.click('[data-confirm="config"]');
        await admin.waitForSelector(outcome, { timeout: 8_000 }).catch(() => {});
      }
    };

    await save();
    check((await alert()).includes('Ничего не изменено'), `сохранение без изменений: «${await alert()}»`);

    await admin.fill('[data-field="maxPiles"]', 'abc');
    await save();
    check((await alert()).includes('Кучек'), `не число: «${await alert()}»`);

    await admin.fill('[data-field="maxPiles"]', '5');
    await admin.fill('[data-field="threshold-2"]', '5');
    await save();
    check((await alert()).includes('Стадия 3'), `пороги не по возрастанию: «${await alert()}»`);
    check(await version() === v0, 'клиентская ошибка дошла до сервера');

    // диапазон проверяет сервер: его отказ показан человеческим текстом, состояние не меняется
    await admin.fill('[data-field="threshold-2"]', '50');
    await admin.fill('[data-field="maxPiles"]', '99');
    await save();
    check((await alert()).includes('Сервер отклонил запрос'), `значение вне диапазона: «${await alert()}»`);
    check((await status()) === '', 'отказ сервера показан как успех');
    check(await version() === v0 && (await publicSnapshot(mock)).config.maxPiles === undefined, 'значение вне диапазона принято сервером');
  });

  await scenario('нормы с даты: запись, будущая дата, «вся игра» стирает, «Убрать»', async ({ mock, newPage, check, urls }) => {
    const snapshot = () => publicSnapshot(mock);
    const admin = await newPage();
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="norms"]');
    await admin.waitForSelector('[data-field="norm-experienced-quality"]', { timeout: 8_000 });
    const field = (name) => admin.inputValue(`[data-field="${name}"]`);
    const alert = () => textOf(admin, '[data-alert="config"]');
    const setDate = (date) => admin.fill('[data-field="from"]', date);
    const preview = async (needle) => {
      await admin.click('[data-save="config"]');
      return waitForText(admin, '[data-preview="config"]', needle);
    };
    const apply = async () => {
      await admin.click('[data-confirm="config"]');
      return waitForText(admin, '[data-status="config"]', 'Сохранено');
    };

    check(await admin.locator('[data-change]').count() === 0, 'список правок по датам не пуст на свежем моке');
    check(!(await admin.locator('[data-field="threshold-1"]').isDisabled()), 'пороги отключены без даты');

    // правка с 10.11: дни 10 и 11 ноября (воронка мока по 11.11) получают новую норму, сервер пишет запись, а не config
    await setDate('2026-11-10');
    check(await admin.locator('[data-field="threshold-1"]').isDisabled(), 'пороги стадий не отключены при выбранной дате');
    check(await field('norm-experienced-quality') === '5', 'форма с датой не предзаполнена значением на дату');
    await admin.fill('[data-field="norm-experienced-quality"]', '50');
    const v0 = (await snapshot()).version;
    const text = await preview('рабочих дней');
    check(text.includes('рабочих дней: 2'), `превью с даты не назвало 2 рабочих дня: «${text}»`);
    check(!text.includes('всю историю'), `превью с даты говорит про всю историю: «${text}»`);
    check((await snapshot()).version === v0, 'правка с даты записана до подтверждения');
    check((await apply()).includes('Сохранено'), `правка с даты не сохранена: «${await alert()}»`);
    let snap = await snapshot();
    check(snap.configChanges.length === 1 && snap.configChanges[0].from === '2026-11-10', `на сервере не одна запись с 10.11: ${JSON.stringify(snap.configChanges)}`);
    check(snap.configChanges[0].config.norms?.experienced?.quality === 50, 'в записи нет новой нормы');
    check(snap.config.norms === undefined, 'правка с даты изменила настройки на всю игру');
    const row = await textOf(admin, '[data-change="2026-11-10"]');
    check(row.includes('10.11.2026') && row.includes('50'), `в списке нет записи с 10.11: «${row}»`);
    check(await field('norm-experienced-quality') === '50', 'после записи форма на дату не показывает новое значение');

    await setDate('');
    check(await field('norm-experienced-quality') === '5', 'без даты форма не вернулась к значениям на всю игру');
    check(!(await admin.locator('[data-field="threshold-1"]').isDisabled()), 'пороги не включились после очистки даты');

    // дата вне игры: ошибка, запросов нет
    await setDate('2026-12-01');
    await admin.fill('[data-field="maxPiles"]', '3');
    await admin.click('[data-save="config"]');
    check((await alert()).includes('Дата'), `дата вне игры принята: «${await alert()}»`);
    check(await admin.locator('[data-preview="config"]').count() === 0, 'для даты вне игры показан предпросмотр');

    // будущая дата: ничего не меняется сегодня, но запись сохраняется
    await setDate('2026-11-20');
    await admin.fill('[data-field="maxPiles"]', '3');
    const future = await preview('оценки дней сегодня не меняются');
    check(future.includes('оценки дней сегодня не меняются') && future.includes('стадии, запасы и кучки сегодня те же'), `будущая дата без пояснения: «${future}»`);
    await admin.click('[data-cancel="config"]');
    check((await snapshot()).configChanges.length === 1, 'отмена будущей правки что-то записала');

    // «вся игра» по тому же полю называет и стирает запись с 10.11
    await setDate('');
    await admin.fill('[data-field="norm-experienced-quality"]', '40');
    const whole = await preview('истори');
    check(whole.includes('10.11.2026'), `превью «на всю игру» не назвало стираемую запись: «${whole}»`);
    check((await apply()).includes('Сохранено'), `правка на всю игру не сохранена: «${await alert()}»`);
    snap = await snapshot();
    check(snap.configChanges.length === 0, `запись с 10.11 не стёрта: ${JSON.stringify(snap.configChanges)}`);
    check(snap.config.norms?.experienced?.quality === 40, 'норма на всю игру не записана');
    check(await admin.locator('[data-change]').count() === 0, 'стёртая запись осталась в списке');

    // «Убрать»: превью → применить → записи нет
    await setDate('2026-11-09');
    await admin.fill('[data-field="maxPiles"]', '3');
    await preview('рабочих дней');
    await apply();
    check((await snapshot()).configChanges.length === 1, 'запись с 9.11 не создана');
    await admin.click('[data-remove-change="2026-11-09"]');
    const removal = await waitForText(admin, '[data-preview="config"]', 'будет убрана');
    check(removal.includes('09.11.2026'), `превью удаления не назвало дату: «${removal}»`);
    check((await snapshot()).configChanges.length === 1, 'запись убрана до подтверждения');
    await apply();
    check((await snapshot()).configChanges.length === 0, 'запись не убрана после подтверждения');
    check(await admin.locator('[data-change]').count() === 0, 'убранная запись осталась в списке');
  });

  await scenario('ручные правки: выдать и сбросить кучки → экран', async ({ mock, newPage, check, urls }) => {
    const screen = await newPage();
    await screen.goto(urls.screen, { waitUntil: 'networkidle' });
    await screen.waitForSelector('[data-group="СР6"] .sub', { timeout: 8_000 });
    const screenPiles = () => screen.$eval('[data-group="СР6"]', (e) => e.dataset.piles).catch(() => '');
    const onServer = async () => (await publicSnapshot(mock)).overrides.length;

    const admin = await newPage();
    await loginAdmin(admin, urls.admin);
    await admin.click('[role="tab"][data-tab="overrides"]');
    await admin.waitForSelector('[data-now="piles"]', { timeout: 8_000 });
    await admin.selectOption('[data-field="group"]', 'СР6');
    check(await admin.inputValue('[data-field="date"]') === '2026-11-12', 'дата по умолчанию не «сегодня» сервера (12.11 в моке)');
    const now = (kind) => textOf(admin, `[data-now="${kind}"]`);
    const alert = () => textOf(admin, '[data-alert="overrides"]');
    const status = () => textOf(admin, '[data-status="overrides"]');
    const done = async (needle = 'Сохранено') => {
      await admin.waitForFunction((t) => document.querySelector('[data-status="overrides"]')?.textContent?.includes(t) || document.querySelector('[data-alert="overrides"]')?.textContent, needle, { timeout: 8_000 }).catch(() => {});
    };

    const piles0 = Number(await now('piles'));
    check(Number.isFinite(piles0) && String(piles0) === await screenPiles(), `кучки СР6: вкладка «${await now('piles')}», экран «${await screenPiles()}»`);

    // выдать две кучки (потолок — maxPiles = 5)
    const n0 = await onServer();
    await admin.fill('[data-field="amount"]', '2');
    await admin.click('[data-give="piles"]');
    await done();
    const piles1 = Math.min(5, piles0 + 2);
    check(await onServer() === n0 + 1 && (await status()).includes('Сохранено'), `выдача кучек: «${await alert()}»`);
    check(Number(await now('piles')) === piles1, `после выдачи во вкладке кучек ${await now('piles')}, ожидалось ${piles1}`);
    check(await admin.locator('[data-table="overrides"] tr[data-override]').count() === 1, 'в таблице правок нет новой строки');
    await screen.waitForFunction((want) => document.querySelector('[data-group="СР6"]')?.dataset.piles === want, String(piles1), { timeout: 8_000 }).catch(() => {});
    check(await screenPiles() === String(piles1), `экран: кучек СР6 ${await screenPiles()}, ожидалось ${piles1}`);

    // сбросить кучки → 0 и на вкладке, и на экране
    await admin.click('[data-reset="piles"]');
    await done();
    check(await now('piles') === '0', `после сброса во вкладке кучек ${await now('piles')}`);
    await screen.waitForFunction(() => document.querySelector('[data-group="СР6"]')?.dataset.piles === '0', null, { timeout: 8_000 }).catch(() => {});
    check(await screenPiles() === '0', `экран: после сброса кучек СР6 ${await screenPiles()}`);

    // сбрасывать нечего — ничего не пишется
    const n1 = await onServer();
    await admin.click('[data-reset="piles"]');
    check((await alert()).includes('Сбрасывать нечего') && await onServer() === n1, `повторный сброс: «${await alert()}»`);

    // клиентские отказы: количество, будущая дата; сервер не вызывается
    await admin.fill('[data-field="amount"]', '21');
    await admin.click('[data-give="toys"]');
    check((await alert()).includes('от 1 до 20') && await onServer() === n1, `количество 21: «${await alert()}»`);
    await admin.fill('[data-field="amount"]', '1');
    await admin.fill('[data-field="date"]', '2026-11-13');
    await admin.click('[data-give="toys"]');
    check((await alert()).includes('будущее') && await onServer() === n1, `дата из будущего: «${await alert()}»`);
    await admin.fill('[data-field="date"]', '2026-11-12');

    // двойной клик по «Выдать» записывает одну правку
    const toys0 = Number(await now('toys'));
    await admin.dblclick('[data-give="toys"]');
    await done();
    check(await onServer() === n1 + 1, `двойной клик записал ${await onServer() - n1} правок вместо одной`);
    check(Number(await now('toys')) === toys0 + 1, `игрушек после выдачи ${await now('toys')}, ожидалось ${toys0 + 1}`);
  });

  await scenario('РГ: вход, расход предмета → экран, PIN не остаётся', async ({ mock, newPage, check, urls, logs }) => {
    const pinOf = (group) => mock.groupPins[group];
    const wrongOf = (pin) => String((Number(pin) + 1) % 1_000_000).padStart(6, '0');
    const post = async (body) => (await fetch(mock.url, {
      method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body),
    })).json();
    const usesOnServer = async () => (await publicSnapshot(mock)).overrides.filter((o) => o.group === 'СР1' && o.kind === 'useToy').length;
    // запас игрушек СР1 не предполагаем: берём трёх про запас админской правкой (двойному клику нужен остаток)
    const given = await post({ action: 'setOverride', pin: MOCK_ADMIN_PIN, date: '2026-11-12', group: 'СР1', kind: 'toys', delta: 3 });
    check(given.ok === true, `выдать три игрушки СР1: ${given.error}`);

    const screen = await newPage();
    await screen.goto(urls.screen, { waitUntil: 'networkidle' });
    await screen.waitForSelector('[data-group="СР1"] .sub', { timeout: 8_000 });

    const rg = await newPage();
    await rg.goto(urls.rg, { waitUntil: 'networkidle' });
    const pin = rg.locator('form[data-login] input[type="password"]');
    check(await pin.count() === 1, 'нет поля PIN во входе РГ');
    check(await pin.getAttribute('name') === null, 'у поля PIN РГ есть атрибут name');
    check(await rg.locator('form[data-login] [data-field="group"] option').count() === GROUP_CODES.length, 'в списке входа не шесть групп');
    const alert = () => textOf(rg, '[role="alert"]');
    const tryLogin = async (group, value) => {
      await rg.selectOption('form[data-login] [data-field="group"]', group);
      await pin.fill(value);
      await rg.click('form[data-login] button[type="submit"]');
    };
    const loginAs = async (group) => {
      await tryLogin(group, pinOf(group));
      await rg.waitForSelector(`[data-group="${group}"]`, { timeout: 8_000 }).catch(() => {});
    };

    // неверный PIN и PIN чужой группы; поле после отправки пустое
    await tryLogin('СР1', wrongOf(pinOf('СР1')));
    check((await waitForText(rg, '[role="alert"]', 'Неверный PIN')).includes('Неверный PIN'), `неверный PIN: «${await alert()}»`);
    check(await pin.inputValue() === '', 'после отправки в поле PIN остался текст');
    await tryLogin('СР2', pinOf('СР1'));
    await rg.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent === 'Неверный PIN', null, { timeout: 5_000 }).catch(() => {});
    check((await alert()).includes('Неверный PIN') && await rg.locator('[data-group]').count() === 0, `PIN СР1 при выбранной СР2: «${await alert()}»`);

    await loginAs('СР1');
    check(await rg.locator('[data-group]').count() === 1 && await rg.locator('[data-group="СР1"]').count() === 1, 'после входа видна не только СР1');
    check(/^(стадия \d+ из 5|яйцо)/.test(await textOf(rg, '[data-stage-text]')), `подпись стадии: «${await textOf(rg, '[data-stage-text]')}»`);
    check(await rg.locator('button[data-use="medkit"]').count() === 1, 'нет предмета «Аптечка»');
    // остаток читаем с бейджа предмета; скрытый `[data-count]` питомца остаётся в DOM для сверки
    const stock = (kind) => rg.$eval(`[data-stock="${kind}"]`, (e) => Number(e.textContent)).catch(() => NaN);
    const toys = () => stock('toy');
    const toys0 = await toys();
    check(Number.isFinite(toys0) && toys0 >= 3, `запас игрушек СР1 на странице РГ ${toys0}, ожидалось не меньше трёх`);
    check(await rg.$eval('[data-count="toys"]', (e) => Number(e.textContent)) === toys0, 'бейдж игрушек и скрытый счётчик питомца расходятся');
    check(await rg.locator('.boxes').isHidden(), 'ящики питомца не скрыты на странице РГ');

    // раскладка «аптечка — питомец — игрушка»
    const box = (selector) => rg.locator(selector).first().boundingBox();
    const [medkitBox, stageBox, toyBox] = [await box('button[data-use="medkit"]'), await box('.stage'), await box('button[data-use="toy"]')];
    check(medkitBox.x + medkitBox.width <= stageBox.x && toyBox.x >= stageBox.x + stageBox.width, 'предметы не по краям от питомца: слева аптечка, справа игрушка');

    const center = async (selector) => { const b = await box(selector); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const useRequests = [];
    rg.on('request', (r) => { if (r.method() === 'POST' && (r.postData() ?? '').includes('"useItem"')) useRequests.push(Date.now()); });
    const drag = async (from, to, { release = true } = {}) => {
      const a = await center(from);
      const b = await center(to);
      await rg.mouse.move(a.x, a.y);
      await rg.mouse.down();
      await rg.mouse.move(b.x, b.y, { steps: 8 });
      if (release) await rg.mouse.up();
    };
    const hintFlashes = () => rg.locator('[data-hint].flash').count();
    const ghostGone = () => rg.waitForSelector('.drag-ghost', { state: 'detached', timeout: 2_000 }).then(() => true, () => false);

    // во время переноса виден призрак и подсвечена зона, на сервер пока ничего не уходит
    await drag('button[data-use="toy"]', '.stage', { release: false });
    check(await rg.locator('.drag-ghost').count() === 1, 'во время переноса нет призрака предмета');
    check(await rg.locator('.stage.drop-ready').count() === 1, 'над питомцем зона не подсвечена');
    check(useRequests.length === 0, 'расход ушёл на сервер до отпускания');

    // отпустили над питомцем → запас −1 здесь, одна запись на сервере и рука у СР1 на общем экране
    const hand = screen.waitForSelector('[data-group="СР1"] .hand[data-item="toy"]', { state: 'attached', timeout: 8_000 }).then(() => true, () => false);
    await rg.mouse.up();
    check(await hintFlashes() === 0, 'после переноса мигнула подсказка: клик после переноса не погашен');
    check(await ghostGone(), 'призрак остался в DOM после переноса');
    await rg.waitForFunction((want) => Number(document.querySelector('[data-stock="toy"]')?.textContent) === want, toys0 - 1, { timeout: 8_000 }).catch(() => {});

    // сразу второй перенос (идёт пауза после расхода, 600 мс): предмет заблокирован, призрака нет, расхода нет
    await drag('button[data-use="toy"]', '.stage', { release: false });
    check(await rg.locator('.drag-ghost').count() === 0, 'во время паузы после расхода предмет можно тащить');
    await rg.mouse.up();

    check(await toys() === toys0 - 1, `после переноса игрушки запас ${await toys()}, ожидалось ${toys0 - 1}`);
    await rg.waitForTimeout(1_000); // если бы второй перенос ушёл на сервер, запас упал бы ещё
    check(await toys() === toys0 - 1 && useRequests.length === 1 && await usesOnServer() === 1, `расходов: запас ${await toys()}, запросов ${useRequests.length}, на сервере ${await usesOnServer()}; ожидался один расход`);
    check(await rg.$eval('[data-count="toys"]', (e) => Number(e.textContent)) === toys0 - 1, 'после переноса бейдж и счётчик питомца расходятся');
    check(await hand, 'на общем экране у СР1 не появилась рука с игрушкой за 8 с после расхода');
    await screen.waitForFunction((want) => Number(document.querySelector('[data-group="СР1"] [data-count="toys"]')?.textContent) === want, toys0 - 1, { timeout: 8_000 }).catch(() => {});
    check(Number(await textOf(screen, '[data-group="СР1"] [data-count="toys"]')) === toys0 - 1, 'общий экран показывает другой запас игрушек, чем страница РГ');

    // мимо питомца: ни расхода, ни призрака
    await drag('button[data-use="toy"]', '[data-hint]');
    check(await ghostGone(), 'после отпускания мимо питомца призрак остался');
    await rg.waitForTimeout(500);
    check(await toys() === toys0 - 1 && useRequests.length === 1, `перенос мимо питомца потратил предмет: запас ${await toys()}, запросов ${useRequests.length}`);

    // унесли и вернули на сам предмет: перенос был, поэтому браузерный клик гасится — ни расхода, ни подсказки
    const home = await center('button[data-use="toy"]');
    await rg.mouse.move(home.x, home.y);
    await rg.mouse.down();
    await rg.mouse.move(home.x + 40, home.y + 30, { steps: 4 });
    await rg.mouse.move(home.x, home.y, { steps: 4 });
    await rg.mouse.up();
    check(await hintFlashes() === 0 && useRequests.length === 1, `перенос обратно на предмет: подсказок ${await hintFlashes()}, запросов ${useRequests.length}`);

    // отпустили рядом с предметом (меньше порога переноса): расхода нет, это обычный клик
    const toyAt = await center('button[data-use="toy"]');
    await rg.mouse.move(toyAt.x, toyAt.y);
    await rg.mouse.down();
    await rg.mouse.move(toyAt.x + 3, toyAt.y + 2);
    await rg.mouse.up();
    check(useRequests.length === 1 && await toys() === toys0 - 1, 'отпускание у самого предмета потратило его');

    // обычный клик: подсказка мигает, расхода нет
    await rg.click('button[data-use="toy"]');
    check(await rg.waitForSelector('[data-hint].flash', { timeout: 2_000 }).then(() => true, () => false), 'клик по предмету не показал подсказку');
    check(useRequests.length === 1, 'обычный клик по предмету потратил его');

    // окно потеряло фокус посреди переноса: призрак возвращается, отпускание над питомцем ничего не тратит
    await rg.waitForFunction(() => !document.querySelector('button[data-use="toy"]')?.disabled, null, { timeout: 5_000 }).catch(() => {});
    await ghostGone(); // призрак прошлого переноса ещё возвращается на место
    await drag('button[data-use="toy"]', '.stage', { release: false });
    check(await rg.locator('.drag-ghost').count() === 1, 'перед потерей фокуса перенос не начался');
    await rg.evaluate(() => window.dispatchEvent(new Event('blur')));
    check(await ghostGone(), 'после потери фокуса окна призрак остался');
    check(await rg.locator('.stage.drop-ready').count() === 0, 'после потери фокуса зона осталась подсвеченной');
    await rg.mouse.up();
    await rg.waitForTimeout(300);
    check(useRequests.length === 1 && await toys() === toys0 - 1, `отпускание после потери фокуса потратило предмет: запросов ${useRequests.length}`);

    // клавиатура: Enter на предмете тратит его (доступность)
    await rg.focus('button[data-use="toy"]');
    await rg.keyboard.press('Enter');
    await rg.waitForFunction((want) => Number(document.querySelector('[data-stock="toy"]')?.textContent) === want, toys0 - 2, { timeout: 8_000 }).catch(() => {});
    check(await toys() === toys0 - 2 && useRequests.length === 2 && await usesOnServer() === 2, `Enter на предмете: запас ${await toys()}, запросов ${useRequests.length}, ожидалось ${toys0 - 2} и два`);

    // нулевой запас: обнуляем игрушки админской правкой (не больше 20 за раз), страница вновь входит и блокирует предмет
    for (let left = toys0 - 2; left > 0; left -= 20) {
      const r = await post({ action: 'setOverride', pin: MOCK_ADMIN_PIN, date: '2026-11-12', group: 'СР1', kind: 'toys', delta: -Math.min(left, 20) });
      check(r.ok === true, `обнулить игрушки СР1: ${r.error}`);
    }
    await rg.reload({ waitUntil: 'networkidle' });
    await loginAs('СР1');
    check(await toys() === 0, `после обнуления запас игрушек ${await toys()}`);
    check(await rg.locator('button[data-use="toy"]').isDisabled(), 'при нулевом запасе предмет «Игрушка» не заблокирован');
    const before = useRequests.length;
    await drag('button[data-use="toy"]', '.stage');
    check(await rg.locator('.drag-ghost').count() === 0 && useRequests.length === before, 'при нулевом запасе перенос что-то сделал');

    // выход: PIN нигде не остаётся
    await rg.click('button[data-logout]');
    await rg.waitForSelector('form[data-login]', { timeout: 5_000 }).catch(() => {});
    check(await rg.locator('form[data-login]').count() === 1 && await rg.locator('[data-group]').count() === 0, 'после выхода не показан вход или остался питомец');
    const dump = await rg.evaluate(() => JSON.stringify({
      html: document.documentElement.outerHTML, href: location.href,
      local: { ...localStorage }, session: { ...sessionStorage },
    }));
    const seen = `${dump}\n${logs.join('\n')}`;
    for (const group of GROUP_CODES) check(!seen.includes(pinOf(group)), `PIN группы ${group} остался в DOM, адресе, хранилище или консоли после выхода`);
  });
  await scenario('итоги: день по умолчанию, раскрытие, правка длинных и отмена', async ({ mock, newPage, check, urls }) => {
    const DAY = '2026-11-11';
    const admin = await newPage();
    const addRequests = [];
    admin.on('request', (r) => { if (r.method() === 'POST' && JSON.parse(r.postData() ?? '{}').action === 'addCorrections') addRequests.push(r); });
    await loginAdmin(admin, urls.admin);
    const shown = await admin.waitForSelector('table.results', { timeout: 8_000 }).then(() => true, () => false);
    check(shown, 'вкладка «Итоги»: нет таблицы');
    if (!shown) return;
    check(await admin.getAttribute('[role="tab"][aria-selected="true"]', 'data-tab') === 'results', '«Итоги» — не первая вкладка');
    const text = (selector) => textOf(admin, selector);

    // день по умолчанию — последний оценённый; в списке дни игры по вчера, выходные помечены
    const dayField = '[data-field="results-day"]';
    check(await admin.inputValue(dayField) === DAY, `день по умолчанию «${await admin.inputValue(dayField)}», ожидался ${DAY}`);
    const days = await admin.$$eval(`${dayField} option`, (os) => os.map((o) => [o.value, o.textContent ?? '']));
    check(days.length === 10 && days[0][0] === '2026-11-02' && days.at(-1)[0] === DAY, `дни игры в списке: ${JSON.stringify(days.map((d) => d[0]))}`);
    check(days.find((d) => d[0] === '2026-11-07')?.[1].includes('выходной') && !days.find((d) => d[0] === '2026-11-06')?.[1].includes('выходной'), 'выходные в списке дней не помечены');
    check(await admin.locator('[data-group-toggle]').count() === GROUP_CODES.length, 'в таблице не шесть групп');
    check(await admin.$$eval('[data-group-toggle]', (b) => b.every((x) => x.getAttribute('aria-expanded') === 'false')), 'группы раскрыты без нажатия');
    check(await admin.locator('[data-employee-row]').count() === 0, 'сотрудники видны у закрытых групп');

    // итог дня: группа, недобравшая длинные, и группа с аптечкой
    const outcomes = await admin.$$eval('[data-outcome]', (els) => els.map((e) => [e.dataset.outcome, e.textContent ?? '']));
    const weak = outcomes.find((o) => o[1].includes('+1 кучка'));
    check(Boolean(weak), `ни у одной группы нет «+1 кучка»: ${JSON.stringify(outcomes)}`);
    check(outcomes.some((o) => o[1].includes('Аптечка, −1 кучка')), 'ни у одной группы нет «Аптечка, −1 кучка»');
    if (!weak) return;
    const g = weak[0];
    check(/длинные \d+(,\d+)? из \d+(,\d+)?/.test(weak[1]) && /игрушка|нет игрушки/.test(weak[1]), `итог дня без причины или игрушки: «${weak[1]}»`);
    const groupLong = `tbody[data-group="${g}"] .group-row [data-cell="day-long"]`;
    const [, fact, plan] = (await text(groupLong)).replace(/,/g, '.').match(/^(\d+(?:\.\d+)?) \/ (\d+(?:\.\d+)?)/) ?? [];
    check(fact !== undefined && Number(fact) < Number(plan) && (await text(groupLong)).includes('✗'), `длинные ${g}: «${await text(groupLong)}»`);
    const shortage = Math.ceil(Number(plan) - Number(fact));

    // раскрытие: сотрудники группы
    const before = await publicSnapshot(mock);
    await admin.click(`[data-group-toggle="${g}"]`);
    check(await admin.getAttribute(`[data-group-toggle="${g}"]`, 'aria-expanded') === 'true', 'нажатие не раскрыло группу');
    const inGroup = before.staff.filter((e) => e.group === g).length;
    const rows = `tbody[data-group="${g}"] tr[data-employee-row]`;
    check(await admin.locator(rows).count() === inGroup, `у ${g} сотрудников ${await admin.locator(rows).count()}, в штате ${inGroup}`);
    const id = await admin.$eval(rows, (r) => r.dataset.employeeRow);
    const fileLong = before.funnel.find((r) => r.employeeId === id && r.date === DAY).long;

    // «Поправить»: поля заполнены текущими значениями, подпись «из файла N»
    await admin.click(`button[data-correct="${id}"]`);
    check(await admin.locator(`form[data-editor="${id}"]`).isVisible(), 'нажатие «Поправить» не открыло редактор');
    check(await admin.inputValue('[data-edit="long"]') === String(fileLong), `длинные в редакторе «${await admin.inputValue('[data-edit="long"]')}», в файле ${fileLong}`);
    check((await text('[data-caption="long"]')).trim() === `из файла ${fileLong}`, `подпись длинных «${await text('[data-caption="long"]')}»`);
    const writes = addRequests.length;
    await admin.click('[data-save="correction"]');
    check((await waitForText(admin, '[data-alert="correction"]', 'Ничего не изменено')).includes('Ничего не изменено') && addRequests.length === writes, `сохранение без изменений: «${await text('[data-alert="correction"]')}», запросов ${addRequests.length - writes}`);

    // правка: длинные добираются до нормы, итог дня меняется, группа остаётся раскрытой
    await admin.fill('[data-edit="long"]', String(fileLong + shortage));
    await admin.click('[data-save="correction"]');
    const flipped = await waitForText(admin, `[data-outcome="${g}"]`, 'Аптечка, −1 кучка');
    check(flipped.includes('Аптечка, −1 кучка') && !flipped.includes('+1 кучка'), `после правки итог дня «${flipped}» / «${await text('[data-alert="correction"]')}»`);
    const corrections = (await publicSnapshot(mock)).corrections ?? [];
    check(
      corrections.length === 1 && corrections[0].employeeId === id && corrections[0].kind === 'long' && corrections[0].date === DAY
        && corrections[0].delta === shortage && corrections[0].base === fileLong,
      `на сервере: ${JSON.stringify(corrections)}`,
    );
    check(addRequests.length === writes + 1, `одно «Сохранить» — запросов ${addRequests.length - writes}`);
    check(await admin.getAttribute(`[data-group-toggle="${g}"]`, 'aria-expanded') === 'true' && await admin.locator(rows).count() === inGroup, 'после правки группа свернулась');
    check((await text(groupLong)).includes(`правки +${shortage}`), `ячейка группы без отметки правки: «${await text(groupLong)}»`);
    check(await admin.locator('[data-corrections] [data-correction]').count() === 1, 'в списке правок нет новой записи');
    const row = await text('[data-corrections] [data-correction]');
    check(row.includes('11.11') && row.includes(g) && row.includes('длинные') && row.includes(`+${shortage}`), `запись в списке правок: «${row}»`);

    // редактор снова: «из файла N, правки +K»
    await admin.click(`button[data-correct="${id}"]`);
    check((await text('[data-caption="long"]')).trim() === `из файла ${fileLong}, правки +${shortage}`, `подпись после правки «${await text('[data-caption="long"]')}»`);
    check(await admin.inputValue('[data-edit="long"]') === String(fileLong + shortage), 'в редакторе не текущее значение');
    await admin.click('[data-cancel="correction"]');
    check(await admin.locator('form[data-editor]').count() === 0, '«Отмена» не закрыла редактор');

    // смена дня и возврат: раскрытая группа остаётся раскрытой
    await admin.selectOption(dayField, '2026-11-10');
    check(await admin.getAttribute(`[data-group-toggle="${g}"]`, 'aria-expanded') === 'true', 'после смены дня группа свернулась');
    await admin.selectOption(dayField, DAY);

    // отмена правки: итог вернулся, группа раскрыта
    await admin.click('[data-corrections] [data-remove-correction]');
    const back = await waitForText(admin, `[data-outcome="${g}"]`, '+1 кучка');
    check(back.includes('+1 кучка') && !back.includes('Аптечка'), `после отмены итог дня «${back}»`);
    check(((await publicSnapshot(mock)).corrections ?? []).length === 0, 'правка осталась на сервере после «Отменить»');
    check(await admin.getAttribute(`[data-group-toggle="${g}"]`, 'aria-expanded') === 'true' && await admin.locator(rows).count() === inGroup, 'после отмены группа свернулась');
    check(await admin.locator('[data-corrections] [data-correction]').count() === 0, 'отменённая правка осталась в списке');

    // отсутствующий (отпуск): воронка не входит в итог группы и не правится, оплаты правятся
    const vacationer = before.staff.find((e) => e.name === MOCK_VACATIONER);
    await admin.click(`[data-group-toggle="${vacationer.group}"]`);
    const vRow = await text(`tr[data-employee-row="${vacationer.id}"]`);
    check(vRow.includes('отпуск') && vRow.includes('не входит в итог группы'), `строка отпускника: «${vRow}»`);
    await admin.click(`button[data-correct="${vacationer.id}"]`);
    check(await admin.locator('[data-edit="quality"]').isDisabled() && await admin.locator('[data-edit="long"]').isDisabled(), 'воронка отпускника доступна для правки');
    check(await admin.locator('[data-edit="payments"]').isEnabled(), 'оплаты отпускника недоступны для правки');
    check((await text(`form[data-editor="${vacationer.id}"]`)).includes('отсутствует'), 'нет причины, по которой воронка недоступна');

    // узкий экран: открытый редактор не раздвигает страницу
    await admin.setViewportSize({ width: 390, height: 800 });
    check(await admin.evaluate(() => document.documentElement.scrollWidth) <= 390, 'телефон: «Итоги» с открытым редактором шире экрана');
    check(await admin.evaluate(() => document.querySelector('.results-scroll').scrollWidth > document.querySelector('.results-scroll').clientWidth), 'телефон: таблица не прокручивается в своём контейнере');
  });

  await scenario('итоги: на время записи вкладка заблокирована, второй клик, повтор после обрыва связи', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    const bodies = [];
    let mode = 'slow';
    let removeSlow = false;
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await admin.route(`${mock.url}**`, async (route) => {
      const request = route.request();
      const action = request.method() === 'POST' ? JSON.parse(request.postData() ?? '{}').action : null;
      if (action === 'removeCorrection' && removeSlow) {
        await pause(1_200);
        return route.continue();
      }
      if (action !== 'addCorrections') return route.continue();
      bodies.push(JSON.parse(request.postData()));
      if (mode === 'slow') {
        await pause(1_200);
        return route.continue();
      }
      if (mode === 'lost') {
        // сервер запись принял, а ответ до страницы не дошёл
        mode = 'normal';
        await route.fetch();
        return route.fulfill({ status: 200, contentType: 'text/plain', body: 'timeout' });
      }
      return route.continue();
    });
    await loginAdmin(admin, urls.admin);
    const shown = await admin.waitForSelector('table.results', { timeout: 8_000 }).then(() => true, () => false);
    check(shown, 'вкладка «Итоги»: нет таблицы');
    if (!shown) return;
    const g = 'СР6';
    const serverCorrections = async () => (await publicSnapshot(mock)).corrections ?? [];
    const rows = `tbody[data-group="${g}"] tr[data-employee-row]`;
    await admin.click(`[data-group-toggle="${g}"]`);
    const [idA, idB] = await admin.$$eval(rows, (r) => r.map((x) => x.dataset.employeeRow));
    const open = async (id, value) => {
      await admin.click(`button[data-correct="${id}"]`);
      await admin.fill('[data-edit="long"]', String(value));
    };
    // всё нажимаемое выбранного вида недоступно (внутри inert) / доступно
    const allInert = (selector) => admin.$$eval(selector, (els) => els.length > 0 && els.every((el) => el.closest('[inert]') !== null));
    const noneInert = (selector) => admin.$$eval(selector, (els) => els.length > 0 && els.every((el) => el.closest('[inert]') === null));
    const unlocked = () => admin.waitForFunction(() => !document.querySelector('[role="tabpanel"] [inert], [role="tabpanel"][inert]'), null, { timeout: 8_000 }).then(() => true, () => false);
    const lockedWhile = async (what, selectors) => {
      for (const [selector, title] of selectors) check(await allInert(selector), `${what}: «${title}» не заблокированы`);
    };
    // вкладки и «Выйти» лежат вне вкладки «Итоги»: на время записи они недоступны (disabled)
    const navDisabled = (want) => admin.$$eval('header button, [role="tablist"] button', (els, disabled) => els.length > 1 && els.every((b) => b.disabled === disabled), want);
    const navLocked = async (what) => {
      check(await navDisabled(true), `${what}: вкладки и «Выйти» не заблокированы`);
      await admin.click('[role="tab"][data-tab="payments"]', { force: true, timeout: 2_000 }).catch(() => {});
      check(await admin.getAttribute('[role="tabpanel"]', 'data-tab') === 'results', `${what}: нажатие вкладки «Оплаты» увело с «Итогов»`);
    };

    // второй клик, пока первая запись ещё идёт: запрос один, запись одна; вкладка на это время заблокирована
    await open(idA, 5);
    await admin.click('[data-save="correction"]');
    await lockedWhile('запись правки', [['[data-correct]', 'Поправить'], ['[data-group-toggle]', 'раскрытие групп'], ['[data-field="results-day"]', 'выбор дня'], ['[data-save="correction"]', 'Сохранить']]);
    await navLocked('запись правки');
    await admin.click('[data-save="correction"]', { force: true, timeout: 2_000 }).catch(() => {});
    await admin.click(`[data-group-toggle="СР1"]`, { force: true, timeout: 2_000 }).catch(() => {});
    check(await admin.getAttribute(`[data-group-toggle="СР1"]`, 'aria-expanded') === 'false', 'во время записи нажатие раскрыло другую группу');
    await admin.click(`button[data-correct="${idB}"]`, { force: true, timeout: 2_000 }).catch(() => {});
    check(await admin.locator('form[data-editor]').count() === 1 && await admin.locator(`form[data-editor="${idB}"]`).count() === 0, 'во время записи открылся второй редактор');
    await waitForText(admin, `tr[data-employee-row="${idA}"]`, 'правки +5');
    check(await unlocked(), 'после записи вкладка осталась заблокированной');
    check(await navDisabled(false), 'после записи вкладки или «Выйти» остались заблокированными');
    check(bodies.length === 1, `два клика по «Сохранить» — запросов ${bodies.length}`);
    check((await serverCorrections()).length === 1, `два клика — правок на сервере ${(await serverCorrections()).length}`);
    check(await noneInert('[data-correct]') && await noneInert('[data-remove-correction]'), 'после записи кнопки не разблокированы');

    // вторая запись при непустом списке: «Отменить» заблокированы; отмена тоже блокирует вкладку
    await open(idB, 3);
    await admin.click('[data-save="correction"]');
    await lockedWhile('запись второй правки', [['[data-remove-correction]', 'Отменить'], ['[data-correct]', 'Поправить']]);
    await waitForText(admin, `tr[data-employee-row="${idB}"]`, 'правки +3');
    check(await unlocked(), 'после второй записи вкладка осталась заблокированной');
    check(await admin.locator('[data-correction]').count() === 2, 'в списке не две правки');
    removeSlow = true;
    await admin.click(`[data-remove-correction="${(await serverCorrections())[0].id}"]`);
    await lockedWhile('отмена правки', [['[data-remove-correction]', 'Отменить'], ['[data-correct]', 'Поправить'], ['[data-group-toggle]', 'раскрытие групп'], ['[data-field="results-day"]', 'выбор дня']]);
    await navLocked('отмена правки');
    await admin.waitForFunction(() => document.querySelectorAll('[data-correction]').length === 1);
    check(await unlocked(), 'после отмены вкладка осталась заблокированной');
    check(await navDisabled(false), 'после отмены вкладки или «Выйти» остались заблокированными');
    removeSlow = false;
    await admin.click('[data-remove-correction]');
    await admin.waitForFunction(() => document.querySelectorAll('[data-correction]').length === 0);
    check((await serverCorrections()).length === 0, 'правки остались на сервере после отмены');

    // обрыв после записи на сервере: поле не потеряно, повтор уходит с тем же ref и не задваивает правку
    mode = 'lost';
    bodies.length = 0;
    await open(idA, 7);
    await admin.click('[data-save="correction"]');
    const failed = await waitForText(admin, '[data-alert="correction"]', 'Нет связи');
    check(failed.includes('Нет связи с сервером'), `после обрыва: «${failed}»`);
    check(await admin.inputValue('[data-edit="long"]') === '7', 'после обрыва введённое значение потеряно');
    check((await serverCorrections()).length === 1, 'контроль: после обрыва запись должна быть на сервере');
    check(await unlocked(), 'после обрыва вкладка осталась заблокированной');
    check(await navDisabled(false), 'после обрыва вкладки или «Выйти» остались заблокированными');
    check(await admin.evaluate(() => document.activeElement?.matches('[data-save="correction"]') === true), 'после ошибки фокус не вернулся на «Сохранить»');
    await admin.click('[data-save="correction"]');
    await waitForText(admin, `tr[data-employee-row="${idA}"]`, 'правки +7');
    check(bodies.length === 2 && bodies[0].ref === bodies[1].ref && typeof bodies[0].ref === 'string', `повтор ушёл с другим ref: ${JSON.stringify(bodies.map((b) => b.ref))}`);
    check((await serverCorrections()).length === 1, `повтор после обрыва задвоил правку: ${(await serverCorrections()).length}`);
    check(await admin.locator('[data-correction]').count() === 1, 'после повтора в списке не одна правка');

    // обрыв, затем другое значение: запись могла дойти, поэтому уходит только повтор прошлого запроса слово в слово
    // (не «4»), затем данные перечитываются
    await admin.click('[data-remove-correction]');
    await admin.waitForFunction(() => document.querySelectorAll('[data-correction]').length === 0);
    mode = 'lost';
    bodies.length = 0;
    await open(idA, 3);
    await admin.click('[data-save="correction"]');
    check((await waitForText(admin, '[data-alert="correction"]', 'Нет связи')).includes('Нет связи'), 'второй обрыв не показан');
    await admin.fill('[data-edit="long"]', '4');
    await admin.click('[data-save="correction"]');
    const reread = await waitForText(admin, '[data-alert="results"]', 'Связь прерывалась');
    check(reread.includes('Связь прерывалась: прошлая правка проверена, данные перечитаны. Проверьте значение и поправьте ещё раз, если нужно.'), `после обрыва и другого значения: «${reread}»`);
    check(
      bodies.length === 2 && bodies[1].ref === bodies[0].ref && JSON.stringify(bodies[1].items) === JSON.stringify(bodies[0].items) && bodies[1].items[0].delta === 3,
      `после обрыва и другого значения ушёл не повтор прошлого запроса: ${JSON.stringify(bodies.map((b) => [b.ref, b.items.map((i) => i.delta)]))}`,
    );
    check(await admin.locator('form[data-editor]').count() === 0, 'после обрыва и другого значения редактор остался открытым');
    const now = await serverCorrections();
    check(now.length === 1 && now[0].delta === 3, `на сервере после обрыва и другого значения: ${JSON.stringify(now)}`);
    check((await textOf(admin, `tr[data-employee-row="${idA}"]`)).includes('правки +3'), 'данные после обрыва не перечитаны: нет «правки +3»');
    await admin.click(`button[data-correct="${idA}"]`);
    check(await admin.inputValue('[data-edit="long"]') === '3', 'после перечитывания в редакторе не записанное значение');
  });

  await scenario('итоги: если после записи данные не обновились, вкладка закрыта до «Обновить»', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    const writes = []; // записи, дошедшие до сервера: addCorrections / removeCorrection
    const adds = []; // тела запросов addCorrections
    let mode = 'normal';
    let rereadFails = false;
    await admin.route(`${mock.url}**`, async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        // чтение снимка не удаётся (ответ не JSON), запись при этом идёт
        if (rereadFails) return route.fulfill({ status: 200, contentType: 'text/plain', body: 'timeout' });
        return route.continue();
      }
      const body = JSON.parse(request.postData() ?? '{}');
      if (body.action === 'addCorrections' || body.action === 'removeCorrection') writes.push(body.action);
      if (body.action === 'addCorrections') adds.push(body);
      if (body.action === 'addCorrections' && mode === 'lost') {
        mode = 'normal';
        await route.fetch();
        return route.fulfill({ status: 200, contentType: 'text/plain', body: 'timeout' });
      }
      return route.continue();
    });
    await loginAdmin(admin, urls.admin);
    const shown = await admin.waitForSelector('table.results', { timeout: 8_000 }).then(() => true, () => false);
    check(shown, 'вкладка «Итоги»: нет таблицы');
    if (!shown) return;
    const g = 'СР6';
    const serverCorrections = async () => (await publicSnapshot(mock)).corrections ?? [];
    await admin.click(`[data-group-toggle="${g}"]`);
    const [idA] = await admin.$$eval(`tbody[data-group="${g}"] tr[data-employee-row]`, (r) => r.map((x) => x.dataset.employeeRow));
    const open = async (id, value) => {
      await admin.click(`button[data-correct="${id}"]`);
      await admin.fill('[data-edit="long"]', String(value));
    };
    const STALE = 'Данные не обновились после записи — нажмите «Обновить»';
    const staleShown = () => admin.waitForFunction(() => document.querySelector('[data-stale]') && !document.querySelector('[data-stale]').hidden, null, { timeout: 8_000 }).then(() => true, () => false);
    const staleGone = () => admin.waitForFunction(() => document.querySelector('[data-stale]')?.hidden === true, null, { timeout: 8_000 }).then(() => true, () => false);
    const allInert = (selector) => admin.$$eval(selector, (els) => els.length > 0 && els.every((el) => el.closest('[inert]') !== null));
    const rowText = (id) => textOf(admin, `tr[data-employee-row="${id}"]`);
    // закрытая вкладка: «Поправить» и «Отменить» недоступны, принудительные клики ничего не открывают и не шлют
    const closedAfterWrite = async (what, expectedWrites) => {
      check(await staleShown(), `${what}: нет сообщения «Данные не обновились…»`);
      check((await textOf(admin, '[data-stale]')).includes(STALE), `${what}: текст сообщения «${await textOf(admin, '[data-stale]')}»`);
      check(await admin.isVisible('[data-refresh]'), `${what}: нет кнопки «Обновить»`);
      check(await allInert('[data-correct]'), `${what}: «Поправить» доступны`);
      await admin.click(`button[data-correct="${idA}"]`, { force: true, timeout: 2_000 }).catch(() => {});
      for (const el of await admin.$$('[data-remove-correction]')) await el.click({ force: true, timeout: 2_000 }).catch(() => {});
      check(await admin.locator('form[data-editor]').count() === 0, `${what}: открылся редактор`);
      check(writes.length === expectedWrites, `${what}: записей на сервере ${writes.length}, ждали ${expectedWrites}`);
    };
    const refreshNow = async () => {
      await admin.click('[data-refresh]');
      return staleGone();
    };

    // 1. правка записана, снимок не прочитан: повтор ввода не должен задвоить правку
    rereadFails = true;
    await open(idA, 5);
    await admin.click('[data-save="correction"]');
    await closedAfterWrite('запись без перечитывания', 1);
    check(!(await rowText(idA)).includes('правки +5'), 'контроль: таблица не должна была обновиться');
    check((await serverCorrections()).length === 1, 'контроль: правка должна быть на сервере');
    await admin.click('[data-refresh]');
    await admin.waitForTimeout(600);
    check(await admin.isVisible('[data-stale]'), '«Обновить» при сбое чтения снял блокировку');
    rereadFails = false;
    check(await refreshNow(), '«Обновить» не снял блокировку, когда чтение удалось');
    check((await rowText(idA)).includes('правки +5'), 'после «Обновить» в таблице нет «правки +5»');
    check(await admin.locator('[data-correction]').count() === 1, 'после «Обновить» в списке не одна правка');
    check(await admin.evaluate(() => !document.querySelector('[role="tabpanel"] [inert]')), 'после «Обновить» часть вкладки осталась заблокированной');

    // 2. отмена прошла, снимок не прочитан: список ещё старый, но «Отменить» повторно ничего не шлёт
    rereadFails = true;
    await admin.click('[data-remove-correction]');
    await closedAfterWrite('отмена без перечитывания', 2);
    check(await admin.locator('[data-correction]').count() === 1, 'контроль: список не должен был обновиться');
    check(await allInert('[data-remove-correction]'), 'отмена без перечитывания: «Отменить» доступна');
    check((await serverCorrections()).length === 0, 'контроль: правка должна быть снята на сервере');
    rereadFails = false;
    check(await refreshNow(), 'после отмены «Обновить» не снял блокировку');
    check(await admin.locator('[data-correction]').count() === 0, 'после «Обновить» в списке остались правки');

    // 3. ответ потерян, затем другое значение, а чтение не удалось: ничего не уходит, пока не «Обновить»
    mode = 'lost';
    await open(idA, 3);
    await admin.click('[data-save="correction"]');
    check((await waitForText(admin, '[data-alert="correction"]', 'Нет связи')).includes('Нет связи'), 'обрыв не показан');
    rereadFails = true;
    await admin.fill('[data-edit="long"]', '4');
    await admin.click('[data-save="correction"]');
    // уходит только повтор потерянного запроса (тот же ref и правки, не «4»), чтение после него не удалось
    await closedAfterWrite('обрыв, другое значение, чтение не удалось', 4);
    check(adds.length === 3 && adds[2].ref === adds[1].ref && JSON.stringify(adds[2].items) === JSON.stringify(adds[1].items), `вместо повтора ушло другое: ${JSON.stringify(adds.map((b) => [b.ref, b.items.map((i) => i.delta)]))}`);
    const lostOnServer = await serverCorrections();
    check(lostOnServer.length === 1 && lostOnServer[0].delta === 3, `на сервере после обрыва: ${JSON.stringify(lostOnServer)}`);
    rereadFails = false;
    check(await refreshNow(), 'после обрыва «Обновить» не снял блокировку');
    check((await rowText(idA)).includes('правки +3'), 'после «Обновить» нет «правки +3»');
    await open(idA, 4);
    await admin.click('[data-save="correction"]');
    await waitForText(admin, `tr[data-employee-row="${idA}"]`, 'правки +4');
    const finalOnServer = (await serverCorrections()).map((c) => c.delta);
    check(finalOnServer.join() === '3,1', `после «Обновить» поправка шла от свежего значения: ${JSON.stringify(finalOnServer)}`);
  });

  await scenario('итоги: потерянная запись проверяется повтором с тем же ключом, а не перечитыванием', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    const adds = []; // тела запросов addCorrections, дошедших до страницы-перехватчика
    const gets = []; // время каждого чтения снимка
    let mode = 'normal';
    let down = false;
    let slowReplay = 0; // задержка следующего запроса addCorrections, мс
    let replayStart = 0;
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await admin.route(`${mock.url}**`, async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') {
        gets.push(Date.now());
        return route.continue();
      }
      const text = request.postData() ?? '{}';
      const body = JSON.parse(text);
      if (body.action !== 'addCorrections') return route.continue();
      adds.push(body);
      if (down) return route.fulfill({ status: 200, contentType: 'text/plain', body: 'timeout' });
      if (slowReplay > 0 && mode === 'normal') {
        replayStart = Date.now();
        await pause(slowReplay);
        slowReplay = 0;
        return route.continue();
      }
      if (mode === 'late') {
        // клиент не дождался, а сервер ещё пишет (холодный старт Apps Script): запрос дойдёт позже
        mode = 'normal';
        setTimeout(() => { fetch(mock.url, { method: 'POST', body: text }).catch(() => {}); }, 2_500);
        return route.fulfill({ status: 200, contentType: 'text/plain', body: 'timeout' });
      }
      if (mode === 'lost') {
        // сервер запись принял, а ответ до страницы не дошёл
        mode = 'normal';
        await route.fetch();
        return route.fulfill({ status: 200, contentType: 'text/plain', body: 'timeout' });
      }
      return route.continue();
    });
    await loginAdmin(admin, urls.admin);
    const shown = await admin.waitForSelector('table.results', { timeout: 8_000 }).then(() => true, () => false);
    check(shown, 'вкладка «Итоги»: нет таблицы');
    if (!shown) return;
    const g = 'СР6';
    const serverDeltas = async () => ((await publicSnapshot(mock)).corrections ?? []).map((c) => c.delta);
    await admin.click(`[data-group-toggle="${g}"]`);
    const [idA, idB] = await admin.$$eval(`tbody[data-group="${g}"] tr[data-employee-row]`, (r) => r.map((x) => x.dataset.employeeRow));
    const open = async (id, value) => {
      await admin.click(`button[data-correct="${id}"]`);
      await admin.fill('[data-edit="long"]', String(value));
    };
    const rowText = (id) => textOf(admin, `tr[data-employee-row="${id}"]`);
    const same = (a, b) => a.ref === b.ref && JSON.stringify(a.items) === JSON.stringify(b.items);
    const INTERRUPTED = 'Связь прерывалась: прошлая правка проверена, данные перечитаны. Проверьте значение и поправьте ещё раз, если нужно.';

    // 1. +7 клиент не дождался, сервер допишет позже; админ сразу вводит 8: итог 8, а не 15
    mode = 'late';
    await open(idA, 7);
    await admin.click('[data-save="correction"]');
    check((await waitForText(admin, '[data-alert="correction"]', 'Нет связи')).includes('Нет связи'), 'обрыв не показан');
    check((await serverDeltas()).length === 0, 'контроль: сервер не должен был успеть записать');
    await admin.fill('[data-edit="long"]', '8');
    await admin.click('[data-save="correction"]');
    const checkedText = await waitForText(admin, '[data-alert="results"]', 'прошлая правка проверена');
    check(checkedText.includes(INTERRUPTED), `после обрыва и другого значения: «${checkedText}»`);
    check(adds.length === 2 && same(adds[0], adds[1]) && adds[1].items[0].delta === 7, `ушёл не повтор прошлого запроса: ${JSON.stringify(adds.map((b) => [b.ref, b.items.map((i) => i.delta)]))}`);
    check((await rowText(idA)).includes('правки +7'), 'повтор не дождался записи: перечитывание не видит «правки +7»');
    await pause(3_200); // «опоздавший» оригинал доходит до сервера и распознаётся как повтор
    check(JSON.stringify(await serverDeltas()) === '[7]', `опоздавший запрос задвоил правку: ${JSON.stringify(await serverDeltas())}`);
    await open(idA, 8);
    await admin.click('[data-save="correction"]');
    await waitForText(admin, `tr[data-employee-row="${idA}"]`, 'правки +8');
    check(JSON.stringify(await serverDeltas()) === '[7,1]', `после ввода 8 на сервере ${JSON.stringify(await serverDeltas())} вместо [7,1]`);

    // 2. ответ потерян, вкладку сменили, повтор на возврате не прошёл: запись закрыта до «Обновить»
    mode = 'lost';
    adds.length = 0;
    await open(idB, 5);
    await admin.click('[data-save="correction"]');
    check((await waitForText(admin, '[data-alert="correction"]', 'Нет связи')).includes('Нет связи'), 'второй обрыв не показан');
    down = true;
    await admin.click('[role="tab"][data-tab="payments"]');
    await admin.waitForSelector('[role="tabpanel"][data-tab="payments"]');
    await admin.click('[role="tab"][data-tab="results"]');
    const stale = await admin.waitForFunction(() => document.querySelector('[data-stale]') && !document.querySelector('[data-stale]').hidden, null, { timeout: 8_000 }).then(() => true, () => false);
    check(stale, 'на возврате к «Итогам» нет сообщения «Данные не обновились…»');
    check(adds.length === 2 && same(adds[0], adds[1]), `на возврате ушло не повторение потерянного запроса: ${JSON.stringify(adds.map((b) => [b.ref, b.items.map((i) => i.delta)]))}`);
    check(await admin.$eval('table.results', (el) => el.closest('[inert]') !== null), 'повтор не прошёл, а таблица открыта для правок');
    check(await admin.locator('form[data-editor]').count() === 0, 'повтор не прошёл, а редактор открыт');
    down = false;
    await admin.click('[data-refresh]');
    await admin.waitForFunction(() => document.querySelector('[data-stale]')?.hidden === true, null, { timeout: 8_000 }).catch(() => {});
    check((await textOf(admin, '[data-alert="results"]')).includes(INTERRUPTED), `после «Обновить» нет сообщения о проверенной правке: «${await textOf(admin, '[data-alert="results"]')}»`);
    check(adds.length === 3 && same(adds[0], adds[2]), '«Обновить» не повторил потерянный запрос слово в слово');
    check(JSON.stringify(await serverDeltas()) === '[7,1,5]', `после проверки на сервере ${JSON.stringify(await serverDeltas())} вместо [7,1,5]`);
    await admin.click(`[data-group-toggle="${g}"]`);
    check((await rowText(idB)).includes('правки +5'), 'после «Обновить» нет «правки +5»');
    await open(idB, 6);
    await admin.click('[data-save="correction"]');
    await waitForText(admin, `tr[data-employee-row="${idB}"]`, 'правки +6');
    check(JSON.stringify(await serverDeltas()) === '[7,1,5,1]', `после «Обновить» правка шла не от свежего значения: ${JSON.stringify(await serverDeltas())}`);

    // 3. открытие вкладки: первый снимок читается только после проверки потерянной записи (она нарочно медленная)
    mode = 'lost';
    adds.length = 0;
    await open(idB, 9);
    await admin.click('[data-save="correction"]');
    check((await waitForText(admin, '[data-alert="correction"]', 'Нет связи')).includes('Нет связи'), 'третий обрыв не показан');
    await admin.click('[role="tab"][data-tab="payments"]');
    await admin.waitForSelector('[role="tabpanel"][data-tab="payments"]');
    slowReplay = 1_200;
    gets.length = 0;
    await admin.click('[role="tab"][data-tab="results"]');
    await admin.waitForSelector('table.results', { timeout: 8_000 });
    const earlyReads = gets.filter((t) => t < replayStart + 1_100);
    check(replayStart > 0 && earlyReads.length === 0, `первый снимок прочитан до окончания проверки: ${earlyReads.length} чтений за время повтора`);
    check(adds.length === 2 && same(adds[0], adds[1]), 'на открытии ушло не повторение потерянного запроса');
    check(await admin.evaluate(() => document.querySelector('[data-stale]')?.hidden === true), 'после удачной проверки вкладка открылась «устаревшей»');
    check((await textOf(admin, '[data-alert="results"]')).includes(INTERRUPTED), 'после проверки на открытии нет сообщения о проверенной правке');
    check(JSON.stringify(await serverDeltas()) === '[7,1,5,1,3]', `на сервере после третьего обрыва ${JSON.stringify(await serverDeltas())}`);
    await admin.click(`[data-group-toggle="${g}"]`);
    check((await rowText(idB)).includes('правки +9'), 'на открытии таблица без только что проверенной правки');
  });

  await scenario('итоги: «Отменить» при потерянной записи сначала выясняет её, отменённая правка не воскресает', async ({ mock, newPage, check, urls }) => {
    const admin = await newPage();
    const adds = []; // тела addCorrections
    const removes = []; // номера в removeCorrection
    let mode = 'normal';
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await admin.route(`${mock.url}**`, async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.continue();
      const body = JSON.parse(request.postData() ?? '{}');
      if (body.action === 'removeCorrection') removes.push(body.id);
      if (body.action !== 'addCorrections') return route.continue();
      adds.push(body);
      if (mode === 'lost') {
        // сервер запись принял, а ответ до страницы не дошёл
        mode = 'normal';
        await route.fetch();
        return route.fulfill({ status: 200, contentType: 'text/plain', body: 'timeout' });
      }
      return route.continue();
    });
    await loginAdmin(admin, urls.admin);
    const shown = await admin.waitForSelector('table.results', { timeout: 8_000 }).then(() => true, () => false);
    check(shown, 'вкладка «Итоги»: нет таблицы');
    if (!shown) return;
    const g = 'СР6';
    const serverCorrections = async () => (await publicSnapshot(mock)).corrections ?? [];
    await admin.click(`[data-group-toggle="${g}"]`);
    const [idA, idB] = await admin.$$eval(`tbody[data-group="${g}"] tr[data-employee-row]`, (r) => r.map((x) => x.dataset.employeeRow));
    const open = async (id, value) => {
      await admin.click(`button[data-correct="${id}"]`);
      await admin.fill('[data-edit="long"]', String(value));
    };
    const INTERRUPTED = 'Связь прерывалась: прошлая правка проверена, данные перечитаны. Проверьте значение и поправьте ещё раз, если нужно.';

    // чужая правка у idB, затем +7 у idA дошло до сервера, а ответ потерян
    await open(idB, 3);
    await admin.click('[data-save="correction"]');
    await waitForText(admin, `tr[data-employee-row="${idB}"]`, 'правки +3');
    const [other] = await serverCorrections();
    mode = 'lost';
    await open(idA, 7);
    await admin.click('[data-save="correction"]');
    check((await waitForText(admin, '[data-alert="correction"]', 'Нет связи')).includes('Нет связи'), 'обрыв не показан');
    check((await serverCorrections()).length === 2, 'контроль: +7 должна быть на сервере');

    // «Отменить» на чужой строке: ничего не удаляется, потерянная запись проверяется, в списке появляется +7
    await admin.click(`[data-remove-correction="${other.id}"]`);
    const checkedText = await waitForText(admin, '[data-alert="results"]', 'прошлая правка проверена');
    check(checkedText.includes(INTERRUPTED), `«Отменить» при потерянной записи: «${checkedText}»`);
    check(removes.length === 0, `«Отменить» удалила, не выяснив запись: ${JSON.stringify(removes)}`);
    check((await serverCorrections()).length === 2, 'после проверки на сервере не две правки');
    check(await admin.locator('[data-correction]').count() === 2, 'после проверки в списке не две правки');
    check(adds.length === 3 && adds[2].ref === adds[1].ref, 'проверка потерянной записи ушла не повтором с тем же ref');

    // отмена +7 на свежих данных
    const plus7 = (await serverCorrections()).find((c) => c.delta === 7);
    await admin.click(`[data-remove-correction="${plus7.id}"]`);
    await admin.waitForFunction(() => document.querySelectorAll('[data-correction]').length === 1);
    check(removes.length === 1 && removes[0] === plus7.id, `отмена +7: ${JSON.stringify(removes)}`);

    // смена вкладки и возврат: повторять нечего, +7 не воскресает
    const addsBefore = adds.length;
    await admin.click('[role="tab"][data-tab="payments"]');
    await admin.waitForSelector('[role="tabpanel"][data-tab="payments"]');
    await admin.click('[role="tab"][data-tab="results"]');
    await admin.waitForSelector('table.results', { timeout: 8_000 });
    await pause(1_000);
    check(adds.length === addsBefore, `на возврате к «Итогам» ушёл повтор отменённой записи: ${adds.length - addsBefore}`);
    const deltas = (await serverCorrections()).map((c) => c.delta);
    check(JSON.stringify(deltas) === '[3]', `отменённая +7 воскресла: ${JSON.stringify(deltas)}`);
    check(await admin.evaluate(() => document.querySelector('[data-stale]')?.hidden === true), 'на возврате к «Итогам» вкладка открылась «устаревшей»');
  });
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('OK: админка — вход и блокировка, «Итоги» с правкой и отменой, разбор загрузки воронки и оплат с правкой, оплаты → экран, импорт оплат и воронки, штат и отсутствия, нормы и ручные правки → экран, РГ — вход и расход предмета → экран, PIN групп не остаются в DOM, хранилище и консоли');
