import { describe, expect, test } from 'vitest';
import type { Snapshot, SnapshotCorrection } from '@/data/api';
import { buildFacts, effectiveFacts } from '@/data/facts';
import { timelineOf } from '@/data/config';
import { defaultConfig } from '@/engine/config';
import { evaluateDay, groupPlan, paymentPlanCents } from '@/engine/evaluate';
import type { PetState } from '@/engine/pet';
import type { Absence, Employee } from '@/engine/staff';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import { groupFunnel } from '@/game/tv/metrics';
import {
  correctionItems, correctionViews, dayResults, defaultResultsDay, moodReason, resultsDays,
  type EmployeeLine, type GroupLine,
} from './results';

const emp = (id: string, name: string, group: GroupCode = 'СР1', extra: Partial<Employee> = {}): Employee => ({
  id, name, shortName: name, group, hireDate: null, fireDate: null, baseLevel: 'experienced',
  hiddenFromRating: false, transfers: [], ...extra,
});
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  version: 1, serverNow: '2026-11-12T10:00:00+03:00', funnelThrough: null, paymentsImportedThrough: null,
  config: {}, configChanges: [], staff: [], absences: [], payments: [], provisional: [], funnel: [], overrides: [], ...over,
});
const pay = (date: DateStr, group: GroupCode, author: string, invoice: string) => ({ date, group, author, invoice });
const fun = (employeeId: string, date: DateStr, quality: number, long: number) => ({ employeeId, date, quality, long });
const corr = (id: number, date: DateStr, employeeId: string, kind: SnapshotCorrection['kind'], delta: number, base = 0): SnapshotCorrection => ({
  id, date, employeeId, kind, delta, base,
});
const lineOf = (lines: GroupLine[], group: GroupCode) => lines.find((l) => l.group === group)!;
const personOf = (lines: GroupLine[], group: GroupCode, id: string) => lineOf(lines, group).employees.find((e) => e.id === id)!;

/**
 * Вымышленный мир. Нормы опытного: качественных 4, длинных 1,5, оплат 1 в день; у новичка 1-й недели 1 / 0 / 0.
 * 02.11 пн, 03.11 вт — рабочие, 04.11 — выходной, 05.11 ср — рабочий. Воронка загружена по 03.11.
 * СР1: Альфов, Бетов (отпуск 03–05.11), Гаммов (новичок с 02.11); СР2: Вегов.
 */
const world = (over: Partial<Snapshot> = {}): Snapshot =>
  snap({
    config: { norms: { experienced: { quality: 4, long: 1.5, payments: 1 } } },
    staff: [
      emp('a1', 'Тест Альфов'),
      emp('a2', 'Тест Бетов'),
      emp('a3', 'Тест Гаммов', 'СР1', { baseLevel: 'rookie1', hireDate: '2026-11-02' }),
      emp('b1', 'Тест Вегов', 'СР2'),
    ],
    absences: [{ employeeId: 'a2', kind: 'vacation', from: '2026-11-03', to: '2026-11-05' }],
    funnelThrough: '2026-11-03',
    paymentsImportedThrough: '2026-11-04',
    funnel: [
      fun('a1', '2026-11-02', 4, 2), fun('a2', '2026-11-02', 3, 1), fun('a3', '2026-11-02', 1, 0), fun('b1', '2026-11-02', 4, 2),
      fun('a1', '2026-11-03', 4, 1), fun('a2', '2026-11-03', 9, 9), fun('a3', '2026-11-03', 1, 0), fun('b1', '2026-11-03', 4, 2),
    ],
    payments: [
      pay('2026-11-02', 'СР1', 'Тест Альфов', 'F-1'),
      pay('2026-11-03', 'СР1', 'Тест Альфов', 'F-2'),
      pay('2026-11-03', 'СР1', 'Тест Альфов', 'F-3'),
      pay('2026-11-03', 'СР1', 'Тест Бетов', 'F-4'),
      pay('2026-11-03', 'СР1', 'Тест Посторонний', 'F-5'),
      pay('2026-11-04', 'СР1', 'Тест Альфов', 'F-6'),
      pay('2026-11-03', 'СР2', 'Тест Вегов', 'G-1'),
      pay('2026-11-07', 'СР2', 'Тест Вегов', 'W-1'),
    ],
    ...over,
  });

describe('resultsDays и defaultResultsDay', () => {
  test('дни игры с 02.11 по вчера сервера, выходные помечены', () => {
    const days = resultsDays(snap({ serverNow: '2026-11-06T09:00:00+03:00' }));
    expect(days).toEqual([
      { date: '2026-11-02', working: true }, { date: '2026-11-03', working: true },
      { date: '2026-11-04', working: false }, { date: '2026-11-05', working: true },
    ]);
  });

  test('до старта игры дней нет, после конца — только дни игры', () => {
    expect(resultsDays(snap({ serverNow: '2026-11-02T09:00:00+03:00' }))).toEqual([]);
    const late = resultsDays(snap({ serverNow: '2026-12-31T09:00:00+03:00' }));
    expect(late[0].date).toBe('2026-11-02');
    expect(late.at(-1)).toEqual({ date: '2026-11-22', working: false });
  });

  test('пустой список выходных: все дни рабочие', () => {
    const days = resultsDays(snap({ serverNow: '2026-11-10T09:00:00+03:00', config: { nonWorking: [] } }));
    expect(days).toHaveLength(8);
    expect(days.every((d) => d.working)).toBe(true);
  });

  test('по умолчанию — последний рабочий день не позже funnelThrough и не позже вчерашнего', () => {
    expect(defaultResultsDay(snap({ funnelThrough: '2026-11-06' }))).toBe('2026-11-06');
    // воронка по воскресенье 08.11: последний рабочий — пятница 06.11
    expect(defaultResultsDay(snap({ funnelThrough: '2026-11-08' }))).toBe('2026-11-06');
    // воронка дальше вчерашнего (вчера 11.11) — берём вчерашний рабочий
    expect(defaultResultsDay(snap({ funnelThrough: '2026-11-20' }))).toBe('2026-11-11');
  });

  test('без воронки — вчерашний день игры, даже выходной', () => {
    expect(defaultResultsDay(snap())).toBe('2026-11-11');
    expect(defaultResultsDay(snap({ serverNow: '2026-11-09T10:00:00+03:00' }))).toBe('2026-11-08');
  });

  test('воронка раньше первого рабочего дня — тоже вчерашний день игры', () => {
    expect(defaultResultsDay(snap({ funnelThrough: '2026-11-01' }))).toBe('2026-11-11');
  });
});

describe('dayResults: строка группы за рабочий день', () => {
  const s = world();
  const lines = dayResults(s, '2026-11-03');
  const sr1 = lineOf(lines, 'СР1');

  test('шесть групп в порядке игры, имя героя из темы комнаты', () => {
    expect(lines.map((l) => l.group)).toEqual(GROUPS);
    expect(sr1.hero).toBe('Лев');
  });

  test('план и факт за день совпадают с evaluateDay, paymentPlanCents и paymentsByDay', () => {
    const cfg = timelineOf(s).at('2026-11-03');
    const r = evaluateDay('СР1', '2026-11-03', s.staff, s.absences, effectiveFacts(s).funnel, cfg);
    expect(sr1.day.quality).toMatchObject({ fact: r.factQuality, plan: r.normQuality });
    expect(sr1.day.long).toMatchObject({ fact: r.factLong, plan: r.normLong });
    expect(sr1.day.payments.plan).toBe(paymentPlanCents('СР1', '2026-11-03', s.staff, s.absences, cfg) / 100);
    expect(sr1.day.payments.fact).toBe(effectiveFacts(s).paymentsByDay.СР1['2026-11-03']);
    // числа руками: на работе Альфов (4 / 1,5 / 1) и новичок Гаммов (1 / 0 / 0); Бетов в отпуске
    expect(sr1.day.quality).toMatchObject({ fact: 5, plan: 5 });
    expect(sr1.day.long).toMatchObject({ fact: 1, plan: 1.5 });
    expect(sr1.day.payments).toMatchObject({ fact: 4, plan: 1, weekend: 0, corrected: 0, stale: false });
  });

  test('итог дня: недобор длинных — кучка на следующий рабочий день, качественные выполнены — игрушка', () => {
    expect(sr1.outcome).toMatchObject({ evaluated: true, medkit: false, pile: true, pileRemoved: false, toy: true, appliesOn: '2026-11-05' });
    if (!sr1.outcome.evaluated) throw new Error('день должен оцениваться');
    expect(sr1.outcome.result).toEqual(
      evaluateDay('СР1', '2026-11-03', s.staff, s.absences, effectiveFacts(s).funnel, timelineOf(s).at('2026-11-03')),
    );
    // то же решает игра: на 05.11 кучек на одну больше, чем на 03.11
    expect(buildFacts(s, '2026-11-05').states.СР1.piles - buildFacts(s, '2026-11-03').states.СР1.piles).toBe(1);
  });

  test('длинные выполнены: аптечка и −1 кучка', () => {
    const lines2 = dayResults(world({ funnel: [...world().funnel, fun('a1', '2026-11-03', 0, 1)] }), '2026-11-03');
    expect(lineOf(lines2, 'СР1').outcome).toMatchObject({ evaluated: true, medkit: true, pile: false, pileRemoved: true });
  });

  test('выходной не оценивается; плана нет ни у одного показателя, оплаты — этого календарного дня', () => {
    const sat = lineOf(dayResults(s, '2026-11-07'), 'СР2');
    expect(sat.outcome).toEqual({ evaluated: false, reason: 'weekend' });
    expect(sat.day.quality.plan).toBeNull();
    expect(sat.day.long.plan).toBeNull();
    expect(sat.day.payments).toMatchObject({ fact: 1, plan: null });
    expect(sat.employees[0].day.payments.plan).toBeNull();
  });

  test('рабочий день после funnelThrough: «воронки нет», плана воронки нет, оплаты — корзина с выходным', () => {
    const wed = lineOf(dayResults(s, '2026-11-05'), 'СР1');
    expect(wed.outcome).toEqual({ evaluated: false, reason: 'no-funnel' });
    expect(wed.day.quality).toMatchObject({ fact: 0, plan: null });
    expect(wed.day.long).toMatchObject({ fact: 0, plan: null });
    // корзина 05.11: 04.11 (выходной, F-6) и 05.11; Бетов в отпуске, Альфов и Гаммов на работе
    expect(wed.day.payments).toMatchObject({ fact: 1, weekend: 1, plan: 1 });
    expect(personOf(dayResults(s, '2026-11-05'), 'СР1', 'a1').day.payments).toMatchObject({ fact: 1, weekend: 1, plan: 1 });
  });

  test('выходные пн: оплата субботы идёт в корзину понедельника, из них в выходные 1', () => {
    const mon = lineOf(dayResults(s, '2026-11-09'), 'СР2');
    expect(mon.outcome).toEqual({ evaluated: false, reason: 'no-funnel' });
    expect(mon.day.payments).toMatchObject({ fact: 1, weekend: 1 });
    expect(personOf(dayResults(s, '2026-11-09'), 'СР2', 'b1').day.payments).toMatchObject({ fact: 1, weekend: 1 });
    // пятница 06.11 — в корзине только свой день
    expect(lineOf(dayResults(s, '2026-11-06'), 'СР2').day.payments).toMatchObject({ fact: 0, weekend: 0 });
  });

  test('пустой список выходных: суббота — обычный рабочий день', () => {
    const open = world({ config: { nonWorking: [], norms: { experienced: { quality: 4, long: 1.5, payments: 1 } } }, funnelThrough: '2026-11-08' });
    const sat = lineOf(dayResults(open, '2026-11-07'), 'СР2');
    expect(sat.outcome).toMatchObject({ evaluated: true, appliesOn: '2026-11-08' });
    expect(sat.day.payments).toMatchObject({ fact: 1, plan: 1, weekend: 0 });
  });

  test('последний рабочий день игры: награде применяться некуда', () => {
    const last = world({ serverNow: '2026-11-25T10:00:00+03:00', funnelThrough: '2026-11-22' });
    expect(lineOf(dayResults(last, '2026-11-20'), 'СР1').outcome).toMatchObject({ evaluated: true, appliesOn: null });
  });
});

describe('dayResults: с начала игры по день', () => {
  const s = world();

  test('воронка: факт — то же, что табло ТВ (groupFunnel), план — нормы оценённых рабочих дней', () => {
    const sr1 = lineOf(dayResults(s, '2026-11-03'), 'СР1');
    const tv = groupFunnel(buildFacts(s, '2026-11-12').rank, '2026-11-03');
    expect(sr1.total.quality.fact).toBe(tv.СР1.quality);
    expect(sr1.total.long.fact).toBe(tv.СР1.long);
    // руками: строки Альфова 4+4, Бетова 3+9 (в отпуске, но строка в факте), Гаммова 1+1
    expect(sr1.total.quality).toMatchObject({ fact: 22, plan: 14 });
    expect(sr1.total.long).toMatchObject({ fact: 13, plan: 4.5 });
  });

  test('день после funnelThrough: факт и план воронки только по оценённым дням', () => {
    const sr1 = lineOf(dayResults(s, '2026-11-05'), 'СР1');
    expect(sr1.total.quality).toMatchObject({ fact: 22, plan: 14 });
    expect(sr1.total.long).toMatchObject({ fact: 13, plan: 4.5 });
  });

  test('строка выходного входит в факт воронки, но не в план', () => {
    const w = world({ funnelThrough: '2026-11-05', funnel: [...world().funnel, fun('a1', '2026-11-04', 2, 0)] });
    const sr1 = lineOf(dayResults(w, '2026-11-05'), 'СР1');
    // факт: 22 + 2 в выходной; план: 02.11 (9) + 03.11 (5) + 05.11 (Альфов 4 + Гаммов 1 = 5)
    expect(sr1.total.quality).toMatchObject({ fact: 24, plan: 19 });
  });

  test('оплаты: все даты не позже D (выходные тоже), план — рабочие дни; даты после D не входят', () => {
    const sr1 = lineOf(dayResults(s, '2026-11-03'), 'СР1');
    // 02.11: F-1; 03.11: F-2..F-5. F-6 (04.11) после D
    expect(sr1.total.payments).toMatchObject({ fact: 5, plan: 3 });
    const later = lineOf(dayResults(s, '2026-11-05'), 'СР1');
    expect(later.total.payments.fact).toBe(6);
    const sr2 = lineOf(dayResults(s, '2026-11-09'), 'СР2');
    expect(sr2.total.payments.fact).toBe(2); // G-1 и W-1 (суббота)
  });

  test('процент плана оплат на всю игру: оплаты до D к плану на все рабочие дни игры', () => {
    const sr1 = lineOf(dayResults(s, '2026-11-03'), 'СР1');
    const cfg = timelineOf(s).at('2026-11-03');
    const { gameCents } = groupPlan('СР1', '2026-11-03', s.staff, s.absences, timelineOf(s).at, cfg);
    expect(gameCents).toBe(3200);
    expect(sr1.gamePlanPercent).toBe(Math.floor((5 * 10000) / gameCents));
    expect(sr1.gamePlanPercent).toBe(15);
  });

  test('плана оплат нет совсем: процент null', () => {
    const none = world({ config: { norms: { experienced: { payments: 0 }, rookie1: { payments: 0 }, rookie2: { payments: 0 } } } });
    expect(lineOf(dayResults(none, '2026-11-03'), 'СР1').gamePlanPercent).toBeNull();
  });
});

describe('dayResults: сотрудники', () => {
  const s = world();
  const lines = dayResults(s, '2026-11-03');

  test('в списке все из группы на день, в том числе отсутствующие; порядок по ФИО', () => {
    expect(lineOf(lines, 'СР1').employees.map((e) => e.id)).toEqual(['a1', 'a2', 'a3']);
    expect(lineOf(lines, 'СР2').employees.map((e) => e.id)).toEqual(['b1']);
  });

  test('сотрудник и его показатели: уровень, факт и план за день и с начала игры', () => {
    const a1 = personOf(lines, 'СР1', 'a1');
    expect(a1).toMatchObject({ name: 'Тест Альфов', level: 'experienced', absence: null, inGroupTotal: true, hidden: false });
    expect(a1.day.quality).toMatchObject({ fact: 4, plan: 4 });
    expect(a1.day.long).toMatchObject({ fact: 1, plan: 1.5 });
    expect(a1.day.payments).toMatchObject({ fact: 2, plan: 1, weekend: 0 });
    expect(a1.total.quality).toMatchObject({ fact: 8, plan: 8 });
    expect(a1.total.long).toMatchObject({ fact: 3, plan: 3 });
    expect(a1.total.payments).toMatchObject({ fact: 3, plan: 2 });
    expect(personOf(lines, 'СР1', 'a3').level).toBe('rookie1');
  });

  test('в отпуске: отметка, не входит в итог группы, план 0, но факт показан', () => {
    const a2 = personOf(lines, 'СР1', 'a2');
    expect(a2).toMatchObject({ level: 'experienced', absence: 'vacation', inGroupTotal: false });
    expect(a2.day.quality).toMatchObject({ fact: 9, plan: 0 });
    expect(a2.day.long).toMatchObject({ fact: 9, plan: 0 });
    expect(a2.day.payments).toMatchObject({ fact: 1, plan: 0 });
    // накопление: план только за 02.11, когда он был на работе
    expect(a2.total.quality).toMatchObject({ fact: 12, plan: 4 });
    expect(a2.total.long).toMatchObject({ fact: 10, plan: 1.5 });
    expect(a2.total.payments).toMatchObject({ fact: 1, plan: 1 });
  });

  test('больничный и «другое» тоже видны в строке', () => {
    const sick: Absence[] = [{ employeeId: 'a1', kind: 'sick', from: '2026-11-03', to: null }];
    expect(personOf(dayResults(world({ absences: sick }), '2026-11-03'), 'СР1', 'a1').absence).toBe('sick');
    const other: Absence[] = [{ employeeId: 'a1', kind: 'other', from: '2026-11-02', to: '2026-11-03' }];
    expect(personOf(dayResults(world({ absences: other }), '2026-11-03'), 'СР1', 'a1').absence).toBe('other');
  });

  test('уволенный до D и принятый после D в списке нет; скрытый из рейтинга есть с пометкой', () => {
    const w = world({
      staff: [
        ...world().staff,
        emp('f1', 'Тест Уволенов', 'СР1', { fireDate: '2026-11-03' }),
        emp('h1', 'Тест Поздников', 'СР1', { hireDate: '2026-11-05' }),
        emp('x1', 'Тест Скрытов', 'СР1', { hiddenFromRating: true }),
      ],
    });
    const list = lineOf(dayResults(w, '2026-11-03'), 'СР1').employees;
    expect(list.map((e) => e.id)).toEqual(['a1', 'a2', 'a3', 'x1']);
    expect(list.find((e) => e.id === 'x1')!.hidden).toBe(true);
    expect(list.find((e) => e.id === 'a1')!.hidden).toBe(false);
  });

  test('перевод: сотрудник числится в группе на выбранный день, а не нынешней', () => {
    const moved = world({ staff: [...world().staff, emp('m1', 'Тест Переводов', 'СР1', { transfers: [{ date: '2026-11-05', group: 'СР2' }] })] });
    expect(lineOf(dayResults(moved, '2026-11-03'), 'СР1').employees.map((e) => e.id)).toContain('m1');
    expect(lineOf(dayResults(moved, '2026-11-05'), 'СР2').employees.map((e) => e.id)).toContain('m1');
    expect(lineOf(dayResults(moved, '2026-11-05'), 'СР1').employees.map((e) => e.id)).not.toContain('m1');
  });

  test('не разнесено по сотрудникам: факт группы минус сумма сотрудников; авторы не из штата отдельно', () => {
    // F-5 написал автор не из штата: группе засчитано 4, сотрудникам 2 + 1 + 0
    expect(lineOf(lines, 'СР1').unassigned).toEqual({ payments: 1, unmatched: 1 });
    expect(lineOf(lines, 'СР2').unassigned).toEqual({ payments: 0, unmatched: 0 });
  });

  test('предварительные числа дня тоже не разнесены; сумма сотрудников больше группы — минус не отсекается', () => {
    const prov = world({ provisional: [{ date: '2026-11-06', group: 'СР1', count: 3 }] });
    expect(lineOf(dayResults(prov, '2026-11-06'), 'СР1').unassigned).toEqual({ payments: 3, unmatched: 0 });
    // Бетов переведён в СР2 в файле, но в штате числится в СР1: счёт у группы СР2, у сотрудника СР1
    const mismatch = world({ payments: [pay('2026-11-03', 'СР2', 'Тест Альфов', 'M-1')] });
    expect(lineOf(dayResults(mismatch, '2026-11-03'), 'СР1').unassigned.payments).toBe(-1);
  });

  test('file и current — значения выбранного календарного дня, а не корзины', () => {
    const wed = personOf(dayResults(s, '2026-11-05'), 'СР1', 'a1');
    expect(wed.day.payments.fact).toBe(1); // корзина: F-6 в выходной
    expect(wed.file.payments).toBe(0);
    expect(wed.current.payments).toBe(0);
    const tue = personOf(dayResults(s, '2026-11-03'), 'СР1', 'a1');
    expect(tue.file).toEqual({ quality: 4, long: 1, payments: 2 });
    expect(tue.current).toEqual({ quality: 4, long: 1, payments: 2 });
  });
});

describe('dayResults: ручные правки в ячейках', () => {
  test('правка длинных +1 включена в факт: группа добирает норму, ячейка помечена', () => {
    const s = world({ corrections: [corr(1, '2026-11-03', 'a1', 'long', 1, 1)] });
    const lines = dayResults(s, '2026-11-03');
    const sr1 = lineOf(lines, 'СР1');
    const a1 = personOf(lines, 'СР1', 'a1');
    expect(a1.day.long).toMatchObject({ fact: 2, plan: 1.5, corrected: 1, stale: false });
    expect(a1.total.long).toMatchObject({ fact: 4, corrected: 1 });
    expect(a1.file.long).toBe(1);
    expect(a1.current.long).toBe(2);
    expect(sr1.day.long).toMatchObject({ fact: 2, corrected: 1, stale: false });
    expect(sr1.total.long).toMatchObject({ fact: 14, corrected: 1 });
    expect(sr1.outcome).toMatchObject({ evaluated: true, medkit: true, pile: false });
    // другие показатели и другие люди не помечены
    expect(a1.day.quality.corrected).toBe(0);
    expect(personOf(lines, 'СР1', 'a3').day.long.corrected).toBe(0);
    expect(lineOf(lines, 'СР2').day.long.corrected).toBe(0);
  });

  test('устаревшая правка (в файле теперь иное значение) помечает ячейки, но не чужие показатели', () => {
    const s = world({ corrections: [corr(1, '2026-11-03', 'a1', 'long', 1, 0)] });
    const lines = dayResults(s, '2026-11-03');
    const a1 = personOf(lines, 'СР1', 'a1');
    expect(a1.day.long.stale).toBe(true);
    expect(a1.total.long.stale).toBe(true);
    expect(lineOf(lines, 'СР1').day.long.stale).toBe(true);
    expect(lineOf(lines, 'СР1').total.long.stale).toBe(true);
    expect(a1.day.quality.stale).toBe(false);
    expect(a1.day.payments.stale).toBe(false);
    expect(lineOf(lines, 'СР2').day.long.stale).toBe(false);
  });

  test('правка оплат в корзине: идёт группе и сотруднику, помечена в ячейке и в накоплении', () => {
    const s = world({ corrections: [corr(1, '2026-11-04', 'a1', 'payments', 2, 1)] });
    const wed = dayResults(s, '2026-11-05');
    const a1 = personOf(wed, 'СР1', 'a1');
    expect(a1.day.payments).toMatchObject({ fact: 3, weekend: 3, corrected: 2, stale: false });
    expect(lineOf(wed, 'СР1').day.payments).toMatchObject({ fact: 3, weekend: 3, corrected: 2 });
    expect(lineOf(wed, 'СР1').total.payments).toMatchObject({ fact: 8, corrected: 2 });
    // правка отдельного дня 04.11 не меняет current за 05.11
    expect(a1.current.payments).toBe(0);
    // до 04.11 включительно правки ещё нет в накоплении
    expect(lineOf(dayResults(s, '2026-11-03'), 'СР1').total.payments.corrected).toBe(0);
  });

  test('минус больше оплат в файле: значение дня 0, а не отрицательное', () => {
    const s = world({ corrections: [corr(1, '2026-11-03', 'a1', 'payments', -5, 2)] });
    const lines = dayResults(s, '2026-11-03');
    const a1 = personOf(lines, 'СР1', 'a1');
    expect(a1.current.payments).toBe(0);
    expect(a1.day.payments).toMatchObject({ fact: 0, corrected: -5 });
    expect(a1.total.payments.fact).toBe(1); // только F-1 за 02.11
    expect(lineOf(lines, 'СР1').day.payments.fact).toBe(0); // 4 − 5 → 0
  });

  test('правка воронки отсутствующего не входит в факт группы за день, но видна у него', () => {
    const s = world({ corrections: [corr(1, '2026-11-03', 'a2', 'quality', 2, 9)] });
    const lines = dayResults(s, '2026-11-03');
    expect(lineOf(lines, 'СР1').day.quality).toMatchObject({ fact: 5, corrected: 0 });
    expect(personOf(lines, 'СР1', 'a2').day.quality).toMatchObject({ fact: 11, corrected: 2 });
  });

  test('правка дня после funnelThrough: у сотрудника видна, в накоплении воронки (как на ТВ) её нет', () => {
    const s = world({ corrections: [corr(1, '2026-11-05', 'a1', 'quality', 3, 0)] });
    const lines = dayResults(s, '2026-11-05');
    const a1 = personOf(lines, 'СР1', 'a1');
    expect(a1.day.quality).toMatchObject({ fact: 3, plan: null, corrected: 3, stale: false });
    expect(a1.current.quality).toBe(3);
    expect(a1.total.quality).toMatchObject({ fact: 8, corrected: 0 });
    expect(lineOf(lines, 'СР1').total.quality.fact).toBe(22);
  });
});

describe('dayResults: «сейчас» и причина настроения', () => {
  /** Пять оплат 02.11 — вылупились. */
  const hatched = (more: ReturnType<typeof pay>[], serverNow: string) =>
    snap({
      serverNow,
      staff: [emp('a1', 'Тест Альфов')],
      payments: [
        ...[1, 2, 3, 4, 5].map((i) => pay('2026-11-02', 'СР1', 'Тест Альфов', `H-${i}`)),
        ...more,
      ],
    });

  test('питомец на сегодня совпадает с buildFacts', () => {
    const s = world();
    const sr1 = lineOf(dayResults(s, '2026-11-03'), 'СР1');
    expect(sr1.now).toBe(buildFacts(s, '2026-11-12').states.СР1);
  });

  test('болезнь по дням без оплат', () => {
    const s = hatched([], '2026-11-06T10:00:00+03:00');
    const sr1 = lineOf(dayResults(s, '2026-11-05'), 'СР1');
    expect(sr1.now.mood).toBe('sick');
    expect(sr1.nowReason).toBe('болеет: 2 раб. дня без оплат');
  });

  test('скука: вчера оплат 0; оплата в выходной попадает во «вчера» понедельника', () => {
    const quiet = hatched([pay('2026-11-03', 'СР1', 'Тест Альфов', 'H-6')], '2026-11-06T10:00:00+03:00');
    const bored = lineOf(dayResults(quiet, '2026-11-05'), 'СР1');
    expect(bored.now.mood).toBe('bored');
    expect(bored.nowReason).toBe('скучает: вчера оплат 0 (меньше 1)');
    const weekendPay = hatched(
      [pay('2026-11-03', 'СР1', 'Тест Альфов', 'H-6'), pay('2026-11-04', 'СР1', 'Тест Альфов', 'H-7')],
      '2026-11-06T10:00:00+03:00',
    );
    const ok = lineOf(dayResults(weekendPay, '2026-11-05'), 'СР1');
    expect(ok.now.mood).toBe('ok');
    expect(ok.nowReason).toBeNull();
  });

  test('скука считает «вчера» корзиной, с оплатой выходного: вчера оплат 1 (меньше 2)', () => {
    const base = hatched(
      [pay('2026-11-03', 'СР1', 'Тест Альфов', 'H-6'), pay('2026-11-04', 'СР1', 'Тест Альфов', 'H-7')],
      '2026-11-06T10:00:00+03:00',
    );
    const strict = { ...base, config: { boredomBelow: 2 } };
    const sr1 = lineOf(dayResults(strict, '2026-11-05'), 'СР1');
    expect(sr1.nowReason).toBe('скучает: вчера оплат 1 (меньше 2)');
  });

  test('яйцо: причины нет', () => {
    expect(lineOf(dayResults(world(), '2026-11-03'), 'СР5').nowReason).toBeNull();
  });
});

describe('correctionViews', () => {
  const s = snap({
    staff: [
      emp('a1', 'Тест Альфов'),
      emp('t1', 'Тест Переводов', 'СР1', { transfers: [{ date: '2026-11-05', group: 'СР2' }] }),
    ],
    funnelThrough: '2026-11-05',
    paymentsImportedThrough: '2026-11-03',
    funnel: [fun('a1', '2026-11-03', 2, 3), fun('a1', '2026-11-05', 0, 1)],
    payments: [pay('2026-11-03', 'СР1', 'Тест Альфов', 'P-1')],
    corrections: [
      corr(1, '2026-11-03', 'a1', 'long', 1, 2), // в файле теперь 3
      corr(2, '2026-11-05', 'a1', 'long', 1, 2), // в файле теперь 1
      corr(3, '2026-11-06', 'a1', 'quality', 2, 0), // воронка за день не загружена
      corr(4, '2026-11-03', 'a1', 'payments', 1, 1), // в файле 1, как и было
      corr(5, '2026-11-05', 'a1', 'payments', 1, 0), // оплаты за день не загружены
      corr(6, '2026-11-03', 'gone', 'long', 1, 0), // сотрудника нет в штате
      corr(7, '2026-11-03', 'a1', 'quality', 1, 2), // в файле 2, как и было
      corr(8, '2026-11-03', 't1', 'payments', 1, 0), // до перевода — СР1
      corr(9, '2026-11-06', 't1', 'payments', 1, 0), // после перевода — СР2
    ],
  });
  const views = correctionViews(s);
  const byId = (id: number) => views.find((v) => v.c.id === id)!;

  test('новые сверху', () => {
    expect(views.map((v) => v.c.id)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  test('файл вырос или уменьшился против base: правка устарела', () => {
    expect(byId(1)).toMatchObject({ fileNow: 3, stale: true, group: 'СР1', name: 'Тест Альфов' });
    expect(byId(2)).toMatchObject({ fileNow: 1, stale: true });
  });

  test('значение из файла совпало с base: не устарела', () => {
    expect(byId(4)).toMatchObject({ fileNow: 1, stale: false });
    expect(byId(7)).toMatchObject({ fileNow: 2, stale: false });
  });

  test('день не загружен: значения из файла нет, правка не устаревшая', () => {
    expect(byId(3)).toMatchObject({ fileNow: null, stale: false });
    expect(byId(5)).toMatchObject({ fileNow: null, stale: false });
  });

  test('строки нет — в файле 0', () => {
    expect(byId(9).fileNow).toBeNull();
    expect(byId(8)).toMatchObject({ fileNow: 0, stale: false });
  });

  test('сотрудник ушёл из штата: правка в списке, группы нет, имя-заглушка', () => {
    expect(byId(6)).toMatchObject({ group: null, name: 'нет в штате', fileNow: 0, stale: false });
  });

  test('группа — на дату правки', () => {
    expect(byId(8).group).toBe('СР1');
    expect(byId(9).group).toBe('СР2');
  });

  test('правок нет: пустой список', () => {
    expect(correctionViews(snap())).toEqual([]);
  });
});

describe('correctionItems', () => {
  const D = '2026-11-03';
  const lineFor = (s: Snapshot, group: GroupCode, id: string, date: DateStr = D): EmployeeLine => personOf(dayResults(s, date), group, id);
  const same = (l: EmployeeLine) => ({ ...l.current });

  test('хочу 3 при текущем 2 и файле 2: одна правка +1 с base 2', () => {
    const s = world({ funnel: world().funnel.map((f) => (f.employeeId === 'a1' && f.date === D ? { ...f, long: 2 } : f)) });
    const a1 = lineFor(s, 'СР1', 'a1');
    expect(a1.current.long).toBe(2);
    expect(correctionItems(a1, { ...same(a1), long: 3 }, D)).toEqual([{ date: D, employeeId: 'a1', kind: 'long', delta: 1, base: 2 }]);
  });

  test('ничего не изменилось: пустой список', () => {
    const a1 = lineFor(world(), 'СР1', 'a1');
    expect(correctionItems(a1, same(a1), D)).toEqual([]);
  });

  test('несколько показателей: по правке на каждый, в порядке качественные, длинные, оплаты', () => {
    const a1 = lineFor(world(), 'СР1', 'a1');
    expect(correctionItems(a1, { quality: 3, long: 2, payments: 0 }, D)).toEqual([
      { date: D, employeeId: 'a1', kind: 'quality', delta: -1, base: 4 },
      { date: D, employeeId: 'a1', kind: 'long', delta: 1, base: 1 },
      { date: D, employeeId: 'a1', kind: 'payments', delta: -2, base: 2 },
    ]);
  });

  test('разница считается от нынешнего значения (файл + правки), base — от файла', () => {
    const s = world({ corrections: [corr(1, D, 'a1', 'long', 1, 1)] });
    const a1 = lineFor(s, 'СР1', 'a1');
    expect(a1.current.long).toBe(2);
    expect(correctionItems(a1, { ...same(a1), long: 1 }, D)).toEqual([{ date: D, employeeId: 'a1', kind: 'long', delta: -1, base: 1 }]);
  });

  test('оплаты: разница от значения дня, а не от корзины с выходными', () => {
    const wed = lineFor(world(), 'СР1', 'a1', '2026-11-05');
    expect(wed.day.payments.fact).toBe(1); // корзина с F-6 за выходной
    expect(correctionItems(wed, { ...same(wed), payments: 1 }, '2026-11-05')).toEqual([
      { date: '2026-11-05', employeeId: 'a1', kind: 'payments', delta: 1, base: 0 },
    ]);
  });

  test('отрицательное, дробное и нечисло — ошибка', () => {
    const a1 = lineFor(world(), 'СР1', 'a1');
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = correctionItems(a1, { ...same(a1), long: bad }, D);
      expect(r).toEqual({ error: expect.stringMatching(/\S/) });
    }
  });

  test('правка больше 50 за раз — ошибка (сервер не примет)', () => {
    const a1 = lineFor(world(), 'СР1', 'a1');
    expect(correctionItems(a1, { ...same(a1), payments: 2 + 51 }, D)).toEqual({ error: expect.any(String) });
    expect(correctionItems(a1, { ...same(a1), payments: 2 + 50 }, D)).toHaveLength(1);
  });

  test('воронка у отсутствующего — ошибка, оплаты у него можно', () => {
    const a2 = lineFor(world(), 'СР1', 'a2');
    expect(a2.inGroupTotal).toBe(false);
    expect(correctionItems(a2, { ...same(a2), long: a2.current.long + 1 }, D)).toEqual({ error: expect.any(String) });
    expect(correctionItems(a2, { ...same(a2), quality: a2.current.quality - 1 }, D)).toEqual({ error: expect.any(String) });
    expect(correctionItems(a2, { ...same(a2), payments: 3 }, D)).toEqual([
      { date: D, employeeId: 'a2', kind: 'payments', delta: 2, base: 1 },
    ]);
    // ничего не меняли в воронке — ошибки нет
    expect(correctionItems(a2, same(a2), D)).toEqual([]);
  });

  test('новый сотрудник из разбора (id new:n) не правится', () => {
    const a1 = lineFor(world(), 'СР1', 'a1');
    expect(correctionItems({ ...a1, id: 'new:1' }, { ...same(a1), long: 3 }, D)).toEqual({ error: expect.any(String) });
  });
});

describe('moodReason', () => {
  const pet = (over: Partial<PetState> = {}): PetState => ({
    alive: true, generation: 0, totalPayments: 10, phase: 'pet', stage: 2, planPercent: 30, medkits: 0, toys: 0, piles: 0,
    mood: 'ok', satiety: 0, noPayDays: 0, ...over,
  });
  const cfg = defaultConfig; // болезнь: 2 дня без оплат или кучек больше 4; скука: вчера меньше 1

  test('болезнь по дням без оплат, с верным склонением', () => {
    expect(moodReason(pet({ mood: 'sick', noPayDays: 2 }), cfg, 0)).toBe('болеет: 2 раб. дня без оплат');
    expect(moodReason(pet({ mood: 'sick', noPayDays: 5 }), cfg, 0)).toBe('болеет: 5 раб. дней без оплат');
    expect(moodReason(pet({ mood: 'sick', noPayDays: 21 }), cfg, 0)).toBe('болеет: 21 раб. день без оплат');
    expect(moodReason(pet({ mood: 'sick', noPayDays: 1 }), { ...cfg, sickDaysNoPay: 1 }, 0)).toBe('болеет: 1 раб. день без оплат');
  });

  test('болезнь по кучкам', () => {
    expect(moodReason(pet({ mood: 'sick', piles: 5 }), cfg, 3)).toBe('болеет: кучек 5 (больше 4)');
  });

  test('обе причины сразу', () => {
    expect(moodReason(pet({ mood: 'sick', piles: 5, noPayDays: 3 }), cfg, 0)).toBe('болеет: 3 раб. дня без оплат, кучек 5 (больше 4)');
  });

  test('грусть, скука, гибель; спокойный питомец и яйцо — без причины', () => {
    expect(moodReason(pet({ mood: 'sad', piles: 2 }), cfg, 3)).toBe('грустит: кучек 2');
    expect(moodReason(pet({ mood: 'bored' }), cfg, 0)).toBe('скучает: вчера оплат 0 (меньше 1)');
    expect(moodReason(pet({ mood: 'bored' }), { ...cfg, boredomBelow: 3 }, 2)).toBe('скучает: вчера оплат 2 (меньше 3)');
    expect(moodReason(pet({ mood: 'bored' }), cfg, null)).toBe('скучает');
    expect(moodReason(pet({ alive: false, mood: 'dead' }), cfg, 0)).toBe('погиб');
    expect(moodReason(pet(), cfg, 0)).toBeNull();
    expect(moodReason(pet({ phase: 'egg0', stage: 0, mood: 'ok' }), cfg, null)).toBeNull();
  });
});
