// Проба парсера воронки на реальной выгрузке: счётчики, время и память, без ФИО в выводе.
// Запуск: node tools/probe-funnel.mjs [путь-к-xlsx]
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'vite';

const file = process.argv[2] ?? readdirSync('.').find((f) => f.endsWith('.xlsx') && f.includes('Воронка'));
if (!file) throw new Error('Укажите путь к xlsx с воронкой');

const server = await createServer({ logLevel: 'error', appType: 'custom', server: { middlewareMode: true } });
try {
  const { parseFunnelXlsx } = await server.ssrLoadModule('/src/import/funnel.ts');
  const bytes = readFileSync(file);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const t0 = performance.now();
  const p = parseFunnelXlsx(buf);
  const ms = Math.round(performance.now() - t0);

  const count = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  const dates = [...new Set(p.rows.map((r) => r.date))].sort();
  const working = dates.filter((d) => ![0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()));
  const filled = dates.filter((d) => p.rows.some((r) => r.date === d && (r.long > 0 || r.quality > 0)));
  console.log(JSON.stringify({
    ms,
    rssMB: Math.round(process.memoryUsage().rss / 1e6),
    employees: p.employees.length,
    byGroup: count(p.employees, (e) => e.group),
    uniqueNames: new Set(p.employees.map((e) => e.name.toLowerCase())).size,
    rows: p.rows.length,
    dates: dates.length,
    weekdaysOnly: working.length === dates.length,
    firstDate: p.firstDate,
    lastDate: p.lastDate,
    lastNonZeroDate: filled.at(-1) ?? null,
    nonZeroDates: filled.length,
  }, null, 2));
} finally {
  await server.close();
}
