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

/** Вход в админку с PIN мока; возвращает страницу с открытой вкладкой «Оплаты». */
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
    check(preview.includes('СР1 — Тест Новый'), `превью воронки: новый сотрудник не назван по имени и группе: «${preview}»`);
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
    check(await field('maxPiles') === '5' && await field('threshold-1') === '6', 'пороги не предзаполнены текущими значениями');
    check(await admin.locator('[data-field^="threshold-"]').count() === 15, 'порогов стадий не 15');

    // факты мока ровно равны норме опытных, поэтому смену видно только при повышении нормы: игрушки перестают копиться
    await admin.fill('[data-field="norm-experienced-quality"]', '50');
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
    check(config.norms?.experienced?.long === configBefore.norms?.experienced?.long && config.maxPiles === configBefore.maxPiles, 'на сервер ушло неизменённое');
    check(await field('norm-experienced-quality') === '50', 'после записи форма не перечитана');

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
    check((await alert()).includes('Порог 2'), `пороги не по возрастанию: «${await alert()}»`);
    check(await version() === v0, 'клиентская ошибка дошла до сервера');

    // диапазон проверяет сервер: его отказ показан человеческим текстом, состояние не меняется
    await admin.fill('[data-field="threshold-2"]', '10');
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
    const future = await preview('сегодня ничего не изменится');
    check(future.includes('сегодня ничего не изменится'), `будущая дата без пояснения: «${future}»`);
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
    check(/^(стадия \d+ из 15|яйцо)/.test(await textOf(rg, '[data-stage-text]')), `подпись стадии: «${await textOf(rg, '[data-stage-text]')}»`);
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
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('OK: админка — вход и блокировка, оплаты → экран, импорт оплат и воронки, штат и отсутствия, нормы и ручные правки → экран, РГ — вход и расход предмета → экран, PIN групп не остаются в DOM, хранилище и консоли');
