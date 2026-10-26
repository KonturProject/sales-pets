// ТОЛЬКО МОК: локальный стенд бэкенда для разработки и check:render. Выполняет настоящий apps-script/Code.gs
// поверх подделок сервисов Google и кладёт в него демо-данные (вымышленные сотрудники из src/demo/demoFacts.ts).
// Админ-PIN здесь 1234 — только для этого мока; в боевом развёртывании PIN задаёт человек, в репозитории его нет.
// «Сейчас» зафиксировано на 12.11.2026, 10:00 по Москве (демо-день): бэкенд принимает импорт только за прошедшие дни.
// Запуск: npm run mock-backend  → http://localhost:8787/exec
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createServer as createVite } from 'vite';
import { loadBackend } from '../apps-script/test/gas-harness.mjs';

export const MOCK_ADMIN_PIN = '1234';
/** Сотрудник демо-штата, который в моке в отпуске 11–13 ноября: в рейтингах 12.11 его быть не должно (check:render). */
export const MOCK_VACATIONER = 'Тест СР1-6';
const DEMO_DAY = '2026-11-12';
/** Предыдущий рабочий день демо-дня: до него файлы «загружены», сегодняшние оплаты — предварительные. */
const THROUGH = '2026-11-11';

function must(result, what) {
  if (!result.ok) throw new Error(`Мок-бэкенд: не удалось ${what}: ${result.error}`);
  return result;
}

/** Кладёт демо в бэкенд его же действиями: штат, воронка по вчера, оплаты строками по вчера и числа за сегодня. */
function seed(backend, demo) {
  const as = (body) => ({ pin: MOCK_ADMIN_PIN, ...body });
  must(
    backend.post(as({
      action: 'setStaff',
      staff: demo.staff.map((e) => ({ name: e.name, shortName: e.shortName, group: e.group, baseLevel: e.baseLevel })),
    })),
    'загрузить штат',
  );
  const vacationer = backend.get({}).staff.find((e) => e.name === MOCK_VACATIONER);
  must(
    backend.post(as({ action: 'setAbsence', employeeId: vacationer.id, kind: 'vacation', from: '2026-11-11', to: '2026-11-13' })),
    'внести отпуск',
  );
  const nameById = Object.fromEntries(demo.staff.map((e) => [e.id, e.name]));
  must(
    backend.post(as({
      action: 'importFunnel',
      through: THROUGH,
      rows: demo.funnel
        .filter((r) => r.date <= THROUGH)
        .map((r) => ({ name: nameById[r.employeeId], date: r.date, quality: r.quality, long: r.long })),
    })),
    'загрузить воронку',
  );

  const rows = [];
  for (const [group, byDay] of Object.entries(demo.paymentsByGroup)) {
    const authors = demo.staff.filter((e) => e.group === group);
    for (const [date, count] of Object.entries(byDay)) {
      if (date > THROUGH) {
        must(backend.post(as({ action: 'setProvisional', date, group, count })), 'внести предварительные оплаты');
        continue;
      }
      for (let i = 0; i < count; i++) rows.push({ date, group, author: authors[i % authors.length].name, invoice: `${group}-${date}-${i + 1}` });
    }
  }
  must(backend.post(as({ action: 'importPayments', from: demo.cfg.startDate, to: THROUGH, rows })), 'загрузить оплаты');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Поднимает мок на 127.0.0.1; `port: 0` — свободный порт. Возвращает адрес `/exec`, PIN шести групп `groupPins` и `close()`. */
export async function startMockBackend({ port = 8787 } = {}) {
  const vite = await createVite({ logLevel: 'error', appType: 'custom', server: { middlewareMode: true } });
  let demo;
  try {
    demo = (await vite.ssrLoadModule('/src/demo/demoFacts.ts')).buildDemo(DEMO_DAY);
  } finally {
    await vite.close();
  }
  const backend = loadBackend({ adminPin: MOCK_ADMIN_PIN });
  seed(backend, demo);
  // PIN групп случайные на каждый запуск мока и нигде не хранятся: проверки и разработчик берут их из возвращаемого значения
  const { groupPins } = must(backend.post({ action: 'setGroupPins', pin: MOCK_ADMIN_PIN }), 'выпустить PIN групп');

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    if (url.pathname !== '/exec' || (req.method !== 'GET' && req.method !== 'POST')) return void res.writeHead(404).end();
    const result = req.method === 'GET' ? backend.get(Object.fromEntries(url.searchParams)) : backend.postRaw(await readBody(req));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(result));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/exec`,
    groupPins,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mock = await startMockBackend({ port: Number(process.env.PORT ?? 8787) });
  console.log(`Мок-бэкенд (ТОЛЬКО МОК, админ-PIN ${MOCK_ADMIN_PIN}): ${mock.url.replace('127.0.0.1', 'localhost')}`);
  console.log('Страница: http://localhost:5173/?backend=' + mock.url.replace('127.0.0.1', 'localhost') + '&asOf=2026-11-12');
}
