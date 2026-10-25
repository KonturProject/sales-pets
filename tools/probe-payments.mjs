// Проба парсера оплат на реальной выгрузке: счётчики и время, без ФИО и сумм в выводе.
// Запуск: node tools/probe-payments.mjs [путь-к-xlsx]
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'vite';

const file = process.argv[2] ?? readdirSync('.').find((f) => f.startsWith('Детальные данные по оплаченным счетам') && f.endsWith('.xlsx'));
if (!file) throw new Error('Укажите путь к xlsx с оплатами');

const server = await createServer({ logLevel: 'error', appType: 'custom', server: { middlewareMode: true } });
try {
  const { parsePaymentsXlsx } = await server.ssrLoadModule('/src/import/payments.ts');
  const bytes = readFileSync(file);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const t0 = performance.now();
  const { rows, skipped } = parsePaymentsXlsx(buf);
  const ms = Math.round(performance.now() - t0);

  const count = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  const dates = rows.map((r) => r.date);
  console.log(JSON.stringify({
    ms,
    kept: rows.length,
    uniqueInvoices: new Set(rows.map((r) => r.invoice)).size,
    uniqueAuthors: new Set(rows.map((r) => r.author)).size,
    skippedByReason: count(skipped, (s) => s.reason),
    byGroup: count(rows, (r) => r.group),
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
  }, null, 2));
} finally {
  await server.close();
}
