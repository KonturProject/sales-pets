import { describe, expect, test } from 'vitest';
import { dayResults, type GroupLine } from '@/admin/results';
import type { Snapshot, SnapshotConfig } from '@/data/api';
import { buildFacts } from '@/data/facts';
import type { Employee } from '@/engine/staff';
import type { DateStr, GroupCode } from '@/engine/types';
import { dayEventPlan, roomText, type DayEventPlan } from './dayEvent';

const emp = (id: string, group: GroupCode, baseLevel: Employee['baseLevel'] = 'experienced'): Employee => ({
  id, name: `Тест ${id}`, shortName: id, group, hireDate: null, fireDate: null, baseLevel, hiddenFromRating: false, transfers: [],
});
const fun = (employeeId: string, date: DateStr, quality: number, long: number) => ({ employeeId, date, quality, long });
const pay = (date: DateStr, group: GroupCode, invoice: string) => ({ date, group, author: 'Тест c1', invoice });
const D2 = '2026-11-02', D3 = '2026-11-03', D5 = '2026-11-05', D6 = '2026-11-06'; // 04.11 — выходной

/** Нормы: опытный 3 / 2, новичок 2-й недели 1 / 1,5, новичок 1-й недели (по умолчанию) 1 / 0. */
const CONFIG: SnapshotConfig = {
  norms: { experienced: { quality: 3, long: 2, payments: 1 }, rookie2: { quality: 1, long: 1.5, payments: 0 } },
};

/**
 * Вымышленный мир на 06.11, воронка по 05.11. Итоги 05.11 по группам:
 * СР1 — яйцо, длинные 0 из 2 (кучка); СР2 — новичок 1-й недели, длинные не нужны, качественные 2 из 1 (игрушка);
 * СР3 — питомец, длинные 2 из 4, качественные 7 из 6 (кучка и игрушка); СР5 — две кучки с 02–03.11, длинные выполнены
 * (аптечка, −1 кучка); СР6 — никого (ничего); СР9 — длинные 2 из 1,5 без кучек (аптечка, убирать нечего).
 */
const world = (over: Partial<Snapshot> = {}): Snapshot => ({
  version: 1, serverNow: '2026-11-06T10:00:00+03:00', funnelThrough: D5, paymentsImportedThrough: D5,
  config: CONFIG, configChanges: [],
  staff: [emp('a1', 'СР1'), emp('b1', 'СР2', 'rookie1'), emp('c1', 'СР3'), emp('c2', 'СР3'), emp('d1', 'СР5'), emp('f1', 'СР9', 'rookie2')],
  absences: [], provisional: [], overrides: [],
  payments: ['F-1', 'F-2', 'F-3', 'F-4', 'F-5'].map((n) => pay(D2, 'СР3', n)),
  funnel: [
    fun('a1', D2, 3, 2), fun('a1', D3, 3, 2),
    fun('b1', D5, 2, 0),
    fun('c1', D2, 3, 2), fun('c2', D2, 3, 2), fun('c1', D3, 3, 2), fun('c2', D3, 3, 2), fun('c1', D5, 4, 1), fun('c2', D5, 3, 1),
    fun('d1', D5, 0, 2),
    fun('f1', D2, 1, 2), fun('f1', D3, 1, 2), fun('f1', D5, 0, 2),
  ],
  ...over,
});
const through = (s: Snapshot, funnelThrough: DateStr | null): Snapshot => ({ ...s, funnelThrough });
const room = (plan: DayEventPlan | null, group: GroupCode) => plan?.rooms.find((r) => r.group === group);
const lineOf = (s: Snapshot, date: DateStr, group: GroupCode): GroupLine => dayResults(s, date).find((l) => l.group === group)!;

describe('dayEventPlan: живое событие (загружена воронка)', () => {
  const s = world();
  const plan = dayEventPlan(through(s, D3), s, D6, null);

  test('воронка по 03.11 → по 05.11 (04.11 выходной): показывается один день 05.11', () => {
    expect(plan).not.toBeNull();
    expect(plan!.through).toBe(D5);
    expect(plan!.days).toEqual([D5]);
  });

  test('«было» — тот же снимок при воронке по 03.11, «стало» — нынешний, оба на asOf', () => {
    const was = buildFacts(through(s, D3), D6).states;
    const now = buildFacts(s, D6).states;
    for (const r of plan!.rooms) {
      expect(r.from).toEqual(was[r.group]);
      expect(r.to).toEqual(now[r.group]);
    }
    expect(room(plan, 'СР3')!.from.piles).toBe(0);
    expect(room(plan, 'СР3')!.to.piles).toBe(1);
  });

  test('комнаты — только с вердиктом или разницей, в порядке GROUPS; яйцо с кучкой — в списке', () => {
    expect(plan!.rooms.map((r) => r.group)).toEqual(['СР1', 'СР2', 'СР3', 'СР5', 'СР9']);
    expect(room(plan, 'СР1')!.to.phase).not.toBe('pet');
    expect(room(plan, 'СР3')!.to.phase).toBe('pet');
  });

  test('плашки по итогам дня', () => {
    expect(room(plan, 'СР1')!.text).toBe('СР1 · итоги 05.11: длинные 0 из 2 — кучка; качественные 0 из 3 — без игрушки');
    expect(room(plan, 'СР2')!.text).toBe('СР2 · итоги 05.11: качественные 2 из 1 — игрушка');
    expect(room(plan, 'СР3')!.text).toBe('СР3 · итоги 05.11: длинные 2 из 4 — кучка; качественные 7 из 6 — игрушка');
    expect(room(plan, 'СР5')!.text).toBe('СР5 · итоги 05.11: длинные 2 из 2 — аптечка, −1 кучка; качественные 0 из 3 — без игрушки');
    // кучек не было: аптечка без «−1 кучка»; дробная норма с запятой
    expect(room(plan, 'СР9')!.text).toBe('СР9 · итоги 05.11: длинные 2 из 1,5 — аптечка; качественные 0 из 1 — без игрушки');
  });

  test('кучек уже максимум: комната показывается, на плашке «кучка (уже 5)»', () => {
    const full = world({ overrides: [{ id: 1, date: D5, group: 'СР1', kind: 'piles', delta: 5 }] });
    const r = room(dayEventPlan(through(full, D3), full, D6, null), 'СР1')!;
    expect(r.from.piles).toBe(5);
    expect(r.to.piles).toBe(5);
    expect(r.text).toBe('СР1 · итоги 05.11: длинные 0 из 2 — кучка (уже 5); качественные 0 из 3 — без игрушки');
  });

  test('мёртвый питомец в список не попадает, даже с вердиктом', () => {
    const dead = world({
      config: { ...CONFIG, deathDaysNoPay: 1 },
      payments: [...world().payments, pay(D3, 'СР3', 'F-6')], // вылупился 02.11, платил 03.11, 05.11 без оплат — погиб
    });
    expect(buildFacts(dead, D6).states.СР3.alive).toBe(false);
    const p = dayEventPlan(through(dead, D3), dead, D6, null);
    expect(p!.rooms.map((r) => r.group)).toEqual(['СР1', 'СР2', 'СР5', 'СР9']);
  });

  test('несколько дней: плашка последнего дня и «ещё N дн.», «было» — при прежней воронке', () => {
    const p = dayEventPlan(through(s, D2), s, D6, null)!;
    expect(p.days).toEqual([D3, D5]);
    expect(room(p, 'СР3')!.text).toBe('СР3 · итоги 05.11: длинные 2 из 4 — кучка; качественные 7 из 6 — игрушка · ещё 1 дн.');
    expect(room(p, 'СР3')!.from).toEqual(buildFacts(through(s, D2), D6).states.СР3);
  });

  test('первая загрузка (прежней воронки не было): все рабочие дни с начала игры', () => {
    expect(dayEventPlan(through(s, null), s, D6, null)!.days).toEqual([D2, D3, D5]);
  });

  test('живое событие не смотрит на shown: хранилище недоступно (shown = funnelThrough) — событие есть', () => {
    expect(dayEventPlan(through(s, D3), s, D6, D5)).toEqual(plan);
  });

  test('funnelThrough не сдвинулся (правка или оплата) → null, даже если сегодня следующий рабочий день', () => {
    const paid = world({ payments: [...world().payments, pay(D5, 'СР1', 'F-9')] });
    expect(dayEventPlan(s, paid, D6, null)).toBeNull();
    expect(dayEventPlan(s, s, D6, null)).toBeNull();
    expect(dayEventPlan(through(s, '2026-11-06'), s, D6, null)).toBeNull(); // воронка «назад»
  });

  test('загрузка только выходных → null', () => {
    expect(dayEventPlan(through(s, D3), through(s, '2026-11-04'), D6, null)).toBeNull();
  });

  test('награды за день ещё не пришли (воронка за сегодня) → этот день не показывается', () => {
    expect(dayEventPlan(through(s, D3), s, D5, null)).toBeNull();
  });

  test('нет комнат с вердиктом или разницей → null', () => {
    const empty = world({ staff: [], payments: [] });
    expect(dayEventPlan(through(empty, D3), empty, D6, null)).toBeNull();
  });
});

describe('dayEventPlan: при запуске ТВ', () => {
  const s = world();

  test('сегодня 06.11 — следующий рабочий после funnelThrough 05.11, ещё не показано → план 05.11, «было» — воронка по 03.11', () => {
    const plan = dayEventPlan(null, s, D6, null)!;
    expect(plan.through).toBe(D5);
    expect(plan.days).toEqual([D5]);
    expect(plan).toEqual(dayEventPlan(through(s, D3), s, D6, null));
  });

  test('уже показано (shown = funnelThrough) → null', () => {
    expect(dayEventPlan(null, s, D6, D5)).toBeNull();
  });

  test('показано за прошлую загрузку → план', () => {
    expect(dayEventPlan(null, s, D6, D3)).not.toBeNull();
  });

  test('сегодня 09.11 — не следующий рабочий после 05.11 → null', () => {
    expect(dayEventPlan(null, world({ serverNow: '2026-11-09T10:00:00+03:00' }), '2026-11-09', null)).toBeNull();
  });

  test('воронки ещё нет → null', () => {
    expect(dayEventPlan(null, through(s, null), D6, null)).toBeNull();
    expect(dayEventPlan(through(s, null), through(s, null), D6, null)).toBeNull();
  });

  test('воронка по воскресенье 08.11, сегодня 09.11 → показывается пятница 06.11', () => {
    const sun = world({ serverNow: '2026-11-09T10:00:00+03:00', funnelThrough: '2026-11-08' });
    expect(dayEventPlan(null, sun, '2026-11-09', null)!.days).toEqual([D6]);
  });
});

describe('roomText', () => {
  const s = world();

  test('строка итогов группы за день', () => {
    expect(roomText(lineOf(s, D5, 'СР3'), [D5])).toBe('СР3 · итоги 05.11: длинные 2 из 4 — кучка; качественные 7 из 6 — игрушка');
  });

  test('два дня — в конце «· ещё 1 дн.»', () => {
    expect(roomText(lineOf(s, D5, 'СР2'), [D3, D5])).toBe('СР2 · итоги 05.11: качественные 2 из 1 — игрушка · ещё 1 дн.');
  });

  test('флаги сужены до того, что случилось: pileRemoved = false — без «−1 кучка», pile = false — «кучка (уже N)» по now', () => {
    const l9 = lineOf(s, D5, 'СР9');
    if (!l9.outcome.evaluated) throw new Error('день должен оцениваться');
    expect(roomText({ ...l9, outcome: { ...l9.outcome, pileRemoved: false } }, [D5])).toContain('— аптечка;');
    expect(roomText(l9, [D5])).toContain('— аптечка, −1 кучка;');

    const l1 = lineOf(s, D5, 'СР1');
    if (!l1.outcome.evaluated) throw new Error('день должен оцениваться');
    const blocked = { ...l1, now: { ...l1.now, piles: 5 }, outcome: { ...l1.outcome, pile: false } };
    expect(roomText(blocked, [D5])).toContain('длинные 0 из 2 — кучка (уже 5);');
  });

  test('нормы качественных нет — без части про качественные', () => {
    expect(roomText(lineOf(s, D5, 'СР6'), [D5])).toBe('СР6 · итоги 05.11');
  });
});
