import { describe, expect, test } from 'vitest';
import { defaultConfig } from '@/engine/config';
import type { Absence, Employee } from '@/engine/staff';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import type { Snapshot } from './api';
import { buildFacts, DEFAULT_DAILY_NORM, normalizeName } from './facts';

const emp = (id: string, name: string, group: GroupCode = 'СР1', extra: Partial<Employee> = {}): Employee => ({
  id, name, shortName: name, group, hireDate: null, fireDate: null, baseLevel: 'experienced',
  hiddenFromRating: false, transfers: [], ...extra,
});
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  version: 1, serverNow: '2026-11-12T10:00:00+03:00', funnelThrough: null, paymentsImportedThrough: null,
  config: {}, staff: [], absences: [], payments: [], provisional: [], funnel: [], ...over,
});
const pay = (date: DateStr, group: GroupCode, author: string, invoice: string) => ({ date, group, author, invoice });

describe('buildFacts', () => {
  test('пустой снимок: у всех групп яйцо и нули, рейтинг пуст, без исключений', () => {
    const { states, rank, unmatchedAuthors } = buildFacts(snap(), '2026-11-12');
    for (const g of GROUPS) {
      expect(states[g]).toMatchObject({ phase: 'egg0', totalPayments: 0, alive: true, piles: 0, medkits: 0, toys: 0 });
    }
    expect(rank.payments).toEqual([]);
    expect(unmatchedAuthors).toEqual([]);
  });

  test('смешанный сценарий: строки импорта и предварительные числа складываются по дням', () => {
    const s = snap({
      staff: [emp('e1', 'Тест Иванов')],
      payments: [
        pay('2026-11-02', 'СР1', 'Тест Иванов', 'A-1'),
        pay('2026-11-02', 'СР1', 'Тест Иванов', 'A-2'),
        pay('2026-11-03', 'СР1', 'Тест Иванов', 'A-3'),
      ],
      provisional: [{ date: '2026-11-12', group: 'СР1', count: 3 }],
    });
    expect(buildFacts(s, '2026-11-12').states.СР1.totalPayments).toBe(6);
  });

  test('если на день и группу есть строки импорта, предварительное число не прибавляется', () => {
    const s = snap({
      staff: [emp('e1', 'Тест Иванов')],
      payments: [pay('2026-11-12', 'СР1', 'Тест Иванов', 'A-1'), pay('2026-11-12', 'СР1', 'Тест Иванов', 'A-2')],
      provisional: [
        { date: '2026-11-12', group: 'СР1', count: 3 },
        { date: '2026-11-12', group: 'СР2', count: 3 },
      ],
    });
    const { states } = buildFacts(s, '2026-11-12');
    expect(states.СР1.totalPayments).toBe(2);
    expect(states.СР2.totalPayments).toBe(3);
  });

  test('один счёт — одна оплата: повтор у двух авторов считается один раз, остаётся ранняя дата', () => {
    const s = snap({
      staff: [emp('e1', 'Тест Иванов'), emp('e2', 'Тест Петров')],
      payments: [pay('2026-11-03', 'СР1', 'Тест Петров', 'A-1'), pay('2026-11-02', 'СР1', 'Тест Иванов', 'A-1')],
    });
    const { states, rank } = buildFacts(s, '2026-11-12');
    expect(states.СР1.totalPayments).toBe(1);
    expect(rank.payments).toEqual([{ employeeId: 'e1', date: '2026-11-02', invoice: 'A-1' }]);
  });

  test('оплата в субботу уходит в следующий рабочий день и считается как оплата понедельника', () => {
    const rows = (date: DateStr) =>
      Array.from({ length: 5 }, (_, i) => pay(date, 'СР1', 'Тест Иванов', `A-${i}`));
    const staff = [emp('e1', 'Тест Иванов')];
    const onSaturday = buildFacts(snap({ staff, payments: rows('2026-11-07') }), '2026-11-09').states.СР1;
    const onMonday = buildFacts(snap({ staff, payments: rows('2026-11-09') }), '2026-11-09').states.СР1;
    expect(onSaturday.totalPayments).toBe(5);
    expect(onSaturday).toEqual(onMonday);
  });

  test('за дни после funnelThrough питомец не штрафуется: воронки там ещё нет', () => {
    const s = snap({
      staff: [emp('e1', 'Тест Иванов')],
      funnelThrough: '2026-11-03',
      funnel: [
        { employeeId: 'e1', date: '2026-11-02', quality: 5, long: 3 },
        { employeeId: 'e1', date: '2026-11-03', quality: 0, long: 0 },
      ],
    });
    // 02: норма выполнена (+аптечка, +игрушка), 03: не выполнена (+кучка); 05, 06, 09, 10 не оцениваются
    expect(buildFacts(s, '2026-11-10').states.СР1).toMatchObject({ medkits: 1, toys: 1, piles: 1 });
  });

  test('funnelThrough на выходном или празднике оценивает дни до него, как через предыдущий рабочий день', () => {
    const day = (date: DateStr, quality: number, long: number) => ({ employeeId: 'e1', date, quality, long });
    const funnel = [day('2026-11-02', 5, 3), day('2026-11-03', 0, 0), day('2026-11-05', 0, 0), day('2026-11-06', 5, 3), day('2026-11-09', 0, 0)];
    const at = (funnelThrough: DateStr, asOf: DateStr) =>
      buildFacts(snap({ staff: [emp('e1', 'Тест Иванов')], funnelThrough, funnel }), asOf).states.СР1;
    // 4 ноября — праздник: оцениваются 02 и 03, а нули 05 (воронки за него ещё нет) штрафа не дают
    expect(at('2026-11-04', '2026-11-06')).toEqual(at('2026-11-03', '2026-11-06'));
    expect(at('2026-11-04', '2026-11-06')).toMatchObject({ medkits: 1, toys: 1, piles: 1 });
    // 8 ноября — воскресенье, asOf — понедельник: оцениваются дни по 06 (выполненный день убирает кучку),
    // нули понедельника не штрафуют
    expect(at('2026-11-08', '2026-11-09')).toEqual(at('2026-11-06', '2026-11-09'));
    expect(at('2026-11-08', '2026-11-09')).toMatchObject({ medkits: 2, toys: 2, piles: 1 });
  });

  test('без funnelThrough воронка не оценивается: ни наград, ни кучек', () => {
    const s = snap({
      staff: [emp('e1', 'Тест Иванов')],
      funnel: [{ employeeId: 'e1', date: '2026-11-02', quality: 5, long: 3 }],
    });
    expect(buildFacts(s, '2026-11-10').states.СР1).toMatchObject({ medkits: 0, toys: 0, piles: 0 });
  });

  test('в рейтинг идёт воронка только до funnelThrough', () => {
    const s = snap({
      staff: [emp('e1', 'Тест Иванов')],
      funnelThrough: '2026-11-03',
      funnel: [
        { employeeId: 'e1', date: '2026-11-03', quality: 5, long: 3 },
        { employeeId: 'e1', date: '2026-11-05', quality: 5, long: 3 },
      ],
    });
    expect(buildFacts(s, '2026-11-12').rank.funnel.map((r) => r.date)).toEqual(['2026-11-03']);
  });

  test('автор вне штата: оплата засчитана группе, в рейтинг не идёт, автор в unmatchedAuthors один раз', () => {
    const s = snap({
      staff: [emp('e1', 'Тест Иванов')],
      payments: [
        pay('2026-11-03', 'СР1', '  тест  ИВАНОВ ', 'I-1'),
        pay('2026-11-03', 'СР1', 'Некто Неизвестный', 'I-2'),
        pay('2026-11-05', 'СР1', 'Некто  Неизвестный', 'I-3'),
      ],
    });
    const { states, rank, unmatchedAuthors } = buildFacts(s, '2026-11-12');
    expect(states.СР1.totalPayments).toBe(3);
    expect(rank.payments).toEqual([{ employeeId: 'e1', date: '2026-11-03', invoice: 'I-1' }]);
    expect(unmatchedAuthors).toEqual(['Некто Неизвестный']);
  });

  test('отпуск задним числом меняет норму только затронутого дня', () => {
    const day = (date: DateStr) => ({ employeeId: 'a', date, quality: 5, long: 3 });
    const base = snap({
      staff: [emp('a', 'Тест А'), emp('b', 'Тест Б')],
      funnelThrough: '2026-11-05',
      funnel: [day('2026-11-02'), day('2026-11-03'), day('2026-11-05')],
    });
    const vacation: Absence = { employeeId: 'b', kind: 'vacation', from: '2026-11-03', to: '2026-11-03' };
    // Б ничего не делает: каждый день группа не добирает нормы (кучка), кроме дня, когда Б в отпуске
    expect(buildFacts(base, '2026-11-06').states.СР1).toMatchObject({ piles: 3, medkits: 0, toys: 0 });
    expect(buildFacts({ ...base, absences: [vacation] }, '2026-11-06').states.СР1)
      .toMatchObject({ piles: 1, medkits: 1, toys: 1 });
  });

  test('дневная норма для сытости: из config, иначе по умолчанию', () => {
    const payments = [pay('2026-11-12', 'СР1', 'Тест Иванов', 'A-1'), pay('2026-11-12', 'СР1', 'Тест Иванов', 'A-2')];
    const staff = [emp('e1', 'Тест Иванов')];
    expect(DEFAULT_DAILY_NORM).toBe(4);
    expect(buildFacts(snap({ staff, payments }), '2026-11-12').states.СР1.satiety).toBe(2 / DEFAULT_DAILY_NORM);
    expect(buildFacts(snap({ staff, payments, config: { dailyNorm: 2 } }), '2026-11-12').states.СР1.satiety).toBe(1);
  });

  test('результат считается один раз на пару «снимок и день»', () => {
    const s = snap();
    const first = buildFacts(s, '2026-11-12');
    expect(buildFacts(s, '2026-11-12')).toBe(first);
    expect(buildFacts(s, '2026-11-13')).not.toBe(first);
    expect(buildFacts(snap(), '2026-11-12')).not.toBe(first);
  });

  test('normalizeName: без краёв, двойных пробелов и регистра', () => {
    expect(normalizeName('  Иван   ПЕТРОВ ')).toBe('иван петров');
  });

  test('rank получает штат, отсутствия и конфиг снимка', () => {
    const vacation: Absence = { employeeId: 'e1', kind: 'vacation', from: '2026-11-03', to: null };
    const s = snap({ staff: [emp('e1', 'Тест Иванов')], absences: [vacation] });
    const { rank } = buildFacts(s, '2026-11-12');
    expect(rank.staff).toBe(s.staff);
    expect(rank.absences).toBe(s.absences);
    expect(rank.cfg).toBe(defaultConfig);
  });
});
