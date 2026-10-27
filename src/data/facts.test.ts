import { describe, expect, test } from 'vitest';
import { defaultConfig } from '@/engine/config';
import type { Absence, Employee } from '@/engine/staff';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import type { Snapshot, SnapshotOverride } from './api';
import { buildFacts, DEFAULT_DAILY_NORM, normalizeName } from './facts';

const emp = (id: string, name: string, group: GroupCode = 'СР1', extra: Partial<Employee> = {}): Employee => ({
  id, name, shortName: name, group, hireDate: null, fireDate: null, baseLevel: 'experienced',
  hiddenFromRating: false, transfers: [], ...extra,
});
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  version: 1, serverNow: '2026-11-12T10:00:00+03:00', funnelThrough: null, paymentsImportedThrough: null,
  config: {}, configChanges: [], staff: [], absences: [], payments: [], provisional: [], funnel: [], overrides: [], ...over,
});
const ov = (id: number, date: DateStr, group: GroupCode, kind: SnapshotOverride['kind'], delta = 1): SnapshotOverride => ({
  id, date, group, kind, delta,
});
/** У СР1 к 3 ноября по одной аптечке и игрушке (день 2 ноября выполнен), воронка загружена по 2 ноября. */
const withStock = (over: Partial<Snapshot> = {}) =>
  snap({
    staff: [emp('e1', 'Тест Иванов')],
    funnelThrough: '2026-11-02',
    funnel: [{ employeeId: 'e1', date: '2026-11-02', quality: 5, long: 3 }],
    ...over,
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

  test('испорченная дневная норма в config заменяется умолчанием, а не делит на ноль', () => {
    const payments = [pay('2026-11-12', 'СР1', 'Тест Иванов', 'A-1'), pay('2026-11-12', 'СР1', 'Тест Иванов', 'A-2')];
    const staff = [emp('e1', 'Тест Иванов')];
    for (const dailyNorm of [0, -3, 2.5, 'x', 1001]) {
      const config = { dailyNorm } as unknown as Snapshot['config'];
      expect(buildFacts(snap({ staff, payments, config }), '2026-11-12').states.СР1.satiety).toBe(2 / DEFAULT_DAILY_NORM);
    }
  });

  test('нормы и пороги снимка доходят до движка и до рейтинга', () => {
    const { rank } = buildFacts(snap({ config: { maxPiles: 7 } }), '2026-11-12');
    expect(rank.cfg).toMatchObject({ ...defaultConfig, maxPiles: 7 });
  });

  test('изменённые нормы из снимка меняют оценку дня', () => {
    const base: Partial<Snapshot> = {
      staff: [emp('e1', 'Тест Иванов')],
      funnelThrough: '2026-11-02',
      funnel: [{ employeeId: 'e1', date: '2026-11-02', quality: 1, long: 1 }],
    };
    // 1 и 1 — меньше нормы опытного (5 и 3): день не выполнен, кучка
    expect(buildFacts(snap(base), '2026-11-03').states.СР1).toMatchObject({ piles: 1, medkits: 0, toys: 0 });
    const lowered = snap({ ...base, config: { norms: { experienced: { quality: 1, long: 1 } } } });
    expect(buildFacts(lowered, '2026-11-03').states.СР1).toMatchObject({ piles: 0, medkits: 1, toys: 1 });
  });

  test('пороги стадий снимка меняют стадию', () => {
    const payments = Array.from({ length: 7 }, (_, i) => pay('2026-11-03', 'СР1', 'Тест Иванов', `A-${i}`));
    const staff = [emp('e1', 'Тест Иванов')];
    expect(buildFacts(snap({ staff, payments }), '2026-11-03').states.СР1.stage).toBe(1); // порог 6
    const thresholds = Array.from({ length: 15 }, (_, i) => 5 + (i + 1) * 5);
    expect(buildFacts(snap({ staff, payments, config: { stageThresholds: thresholds } }), '2026-11-03').states.СР1.stage).toBe(0);
  });

  test('ручная правка кучек на день попадает в состояние группы', () => {
    const s = snap({ overrides: [ov(1, '2026-11-03', 'СР1', 'piles', 2)] });
    expect(buildFacts(s, '2026-11-03').states.СР1.piles).toBe(2);
    expect(buildFacts(s, '2026-11-02').states.СР1.piles).toBe(0); // правка из будущего пока не действует
  });

  test('правки применяются по возрастанию id, как бы ни лежал массив', () => {
    const rows = [ov(5, '2026-11-03', 'СР1', 'piles', -1), ov(3, '2026-11-03', 'СР1', 'piles', 2)];
    // +2, затем −1 → 1 (в обратном порядке: −1 упрётся в ноль, потом +2 → 2)
    expect(buildFacts(snap({ overrides: rows }), '2026-11-03').states.СР1.piles).toBe(1);
  });

  test('правки другой группы не влияют на эту', () => {
    const s = snap({ overrides: [ov(1, '2026-11-03', 'СР2', 'piles', 2)] });
    const { states } = buildFacts(s, '2026-11-03');
    expect(states.СР1.piles).toBe(0);
    expect(states.СР2.piles).toBe(2);
  });

  test('расход аптечки и игрушки при запасе уменьшает его, даже если день позже funnelThrough', () => {
    expect(buildFacts(withStock(), '2026-11-12').states.СР1).toMatchObject({ medkits: 1, toys: 1 });
    const used = withStock({ overrides: [ov(1, '2026-11-12', 'СР1', 'useMedkit'), ov(2, '2026-11-12', 'СР1', 'useToy')] });
    expect(buildFacts(used, '2026-11-12').states.СР1).toMatchObject({ medkits: 0, toys: 0 });
  });

  test('расход при нулевом запасе ничего не меняет', () => {
    const empty = buildFacts(snap(), '2026-11-12').states;
    const used = snap({ overrides: [ov(1, '2026-11-12', 'СР1', 'useMedkit'), ov(2, '2026-11-12', 'СР1', 'useToy')] });
    expect(buildFacts(used, '2026-11-12').states).toEqual(empty);
  });

  test('результат считается один раз на пару «снимок и день», в том числе с config в снимке', () => {
    const s = snap({ config: { maxPiles: 7 } });
    expect(buildFacts(s, '2026-11-12')).toBe(buildFacts(s, '2026-11-12'));
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

  describe('нормы и пороги с даты', () => {
    const lowerFrom = (from: DateStr) => [{ from, config: { norms: { experienced: { quality: 1, long: 1 } } } }];
    const base: Partial<Snapshot> = {
      staff: [emp('e1', 'Тест Иванов')],
      funnelThrough: '2026-11-03',
      funnel: [
        { employeeId: 'e1', date: '2026-11-02', quality: 1, long: 1 },
        { employeeId: 'e1', date: '2026-11-03', quality: 1, long: 1 },
      ],
    };

    test('день судится нормой своего дня: 02.11 по старой (кучка), 03.11 по новой (аптечка и игрушка)', () => {
      const s = snap({ ...base, configChanges: lowerFrom('2026-11-03') });
      // 11-04 — праздник, 05.11: кучка за 02.11 и награда за 03.11 (+1 аптечка, +1 игрушка, −1 кучка)
      expect(buildFacts(s, '2026-11-05').states.СР1).toMatchObject({ piles: 0, medkits: 1, toys: 1 });
      // для сравнения: новая норма на всю игру выдала бы награды за оба дня, старая — две кучки
      expect(buildFacts(snap({ ...base, config: { norms: { experienced: { quality: 1, long: 1 } } } }), '2026-11-05').states.СР1)
        .toMatchObject({ piles: 0, medkits: 2, toys: 2 });
      expect(buildFacts(snap(base), '2026-11-05').states.СР1).toMatchObject({ piles: 2, medkits: 0, toys: 0 });
    });

    test('состояние на дату до смены совпадает с неизменённым снимком', () => {
      const changed = snap({ ...base, configChanges: lowerFrom('2026-11-03') });
      expect(buildFacts(changed, '2026-11-03').states).toEqual(buildFacts(snap(base), '2026-11-03').states);
    });

    test('from в выходной действует с ближайшего рабочего дня', () => {
      const weekend = snap({ ...base, funnelThrough: '2026-11-09', funnel: [{ employeeId: 'e1', date: '2026-11-06', quality: 1, long: 1 }, { employeeId: 'e1', date: '2026-11-09', quality: 1, long: 1 }], configChanges: lowerFrom('2026-11-07') });
      const monday = snap({ ...weekend, configChanges: lowerFrom('2026-11-09') });
      expect(buildFacts(weekend, '2026-11-10').states).toEqual(buildFacts(monday, '2026-11-10').states);
    });

    test('дневная норма для сытости берётся на дату asOf', () => {
      const staff = [emp('e1', 'Тест Иванов')];
      const payments = ['2026-11-09', '2026-11-12'].flatMap((d) => [pay(d, 'СР1', 'Тест Иванов', `${d}-1`), pay(d, 'СР1', 'Тест Иванов', `${d}-2`)]);
      const s = snap({ staff, payments, configChanges: [{ from: '2026-11-10', config: { dailyNorm: 2 } }] });
      expect(buildFacts(s, '2026-11-09').states.СР1.satiety).toBe(2 / DEFAULT_DAILY_NORM);
      expect(buildFacts(s, '2026-11-12').states.СР1.satiety).toBe(1);
    });

    test('rank получает cfg на asOf и cfgOn по датам', () => {
      const s = snap({ configChanges: [{ from: '2026-11-05', config: { maxPiles: 2 } }] });
      const { rank } = buildFacts(s, '2026-11-12');
      expect(rank.cfg.maxPiles).toBe(2);
      expect(rank.cfgOn?.('2026-11-03').maxPiles).toBe(defaultConfig.maxPiles);
      expect(rank.cfgOn?.('2026-11-05').maxPiles).toBe(2);
    });

    test('результат по-прежнему считается один раз на пару «снимок и день»', () => {
      const s = snap({ configChanges: lowerFrom('2026-11-03') });
      expect(buildFacts(s, '2026-11-12')).toBe(buildFacts(s, '2026-11-12'));
    });
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
