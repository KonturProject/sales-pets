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
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`FAIL (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('OK: админка — вход и блокировка, оплаты → экран, импорт оплат и воронки, штат и отсутствия, PIN групп не остаются в DOM, хранилище и консоли');
