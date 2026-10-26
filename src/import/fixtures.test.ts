import { describe, expect, test } from 'vitest';
import { funnelXlsx, paymentsXlsx } from './fixtures';
import { parseFunnelXlsx } from './funnel';
import { parsePaymentsXlsx } from './payments';

describe('фикстуры выгрузок', () => {
  test('paymentsXlsx разбирается парсером в те же оплаты', () => {
    const rows = [
      { date: '2026-11-10', group: 'СР1', author: 'Тест Один', invoice: 'T-1' },
      { date: '2026-11-11', group: 'СР5', author: 'Тест Два', invoice: 'T-2' },
    ] as const;
    expect(parsePaymentsXlsx(paymentsXlsx([...rows])).rows).toEqual(rows);
  });

  test('funnelXlsx разбирается парсером: сотрудники по группам, значения по дням, итоги недели не дни', () => {
    const buf = funnelXlsx(['2026-11-10', '2026-11-11', '2026-11-12'], [
      { group: 'СР1', people: [{ name: 'Тест Один', quality: 4, long: 2 }] },
      { group: 'СР5', people: [{ name: 'Тест Два', quality: 1, long: 0 }] },
    ]);
    const p = parseFunnelXlsx(buf);
    expect(p.employees).toEqual([{ name: 'Тест Один', group: 'СР1' }, { name: 'Тест Два', group: 'СР5' }]);
    expect(p.firstDate).toBe('2026-11-10');
    expect(p.lastDate).toBe('2026-11-12');
    expect(p.rows.filter((r) => r.name === 'Тест Один')).toEqual([
      { name: 'Тест Один', date: '2026-11-10', quality: 4, long: 2 },
      { name: 'Тест Один', date: '2026-11-11', quality: 4, long: 2 },
      { name: 'Тест Один', date: '2026-11-12', quality: 4, long: 2 },
    ]);
    expect(p.outside).toBe(0);
  });
});
