import { describe, expect, test } from 'vitest';
import type { Snapshot, SnapshotCorrection } from '@/data/api';
import type { Employee } from '@/engine/staff';
import type { DateStr, GroupCode } from '@/engine/types';
import { describeChange } from './configPreview';
import { dayChangeText, effectsOf } from './effects';

const emp = (id: string, name: string, group: GroupCode = 'СР1'): Employee => ({
  id, name, shortName: name, group, hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [],
});
const fun = (employeeId: string, date: DateStr, quality: number, long: number) => ({ employeeId, date, quality, long });
const corr = (id: number, date: DateStr, employeeId: string, kind: SnapshotCorrection['kind'], delta: number, base: number): SnapshotCorrection => ({
  id, date, employeeId, kind, delta, base,
});

/**
 * Вымышленный мир: норма опытного — качественных 4, длинных 1,5, оплат 1. 02.11 и 03.11 рабочие, воронка загружена по 03.11.
 * СР1: Альфов (03.11: качественных 4, длинных 1 — группа недобрала длинные: «+1 кучка», игрушка есть); СР2: Вегов.
 */
const world = (over: Partial<Snapshot> = {}): Snapshot => ({
  version: 1, serverNow: '2026-11-05T10:00:00+03:00', funnelThrough: '2026-11-03', paymentsImportedThrough: '2026-11-03',
  config: { norms: { experienced: { quality: 4, long: 1.5, payments: 1 } } }, configChanges: [],
  staff: [emp('a1', 'Тест Альфов'), emp('b1', 'Тест Вегов', 'СР2')],
  absences: [], payments: [], provisional: [], overrides: [],
  funnel: [fun('a1', '2026-11-02', 4, 2), fun('b1', '2026-11-02', 4, 2), fun('a1', '2026-11-03', 4, 1), fun('b1', '2026-11-03', 4, 2)],
  ...over,
});
/** Снимок с другой воронкой: заменяет строки по паре «сотрудник, день». */
const withFunnel = (s: Snapshot, rows: Snapshot['funnel'], funnelThrough = s.funnelThrough): Snapshot => ({
  ...s,
  funnelThrough,
  funnel: [...s.funnel.filter((f) => !rows.some((r) => r.employeeId === f.employeeId && r.date === f.date)), ...rows],
});

describe('effectsOf: что изменится между двумя снимками', () => {
  test('файл поднял длинные за прошлый день — «СР1 03.11: +1 кучка → аптечка»', () => {
    const before = world();
    const after = withFunnel(before, [fun('a1', '2026-11-03', 4, 2)]);
    const { days } = effectsOf(before, after);
    expect(days).toEqual([{ group: 'СР1', date: '2026-11-03', before: '+1 кучка', after: 'аптечка' }]);
    expect(dayChangeText(days[0])).toBe('СР1 03.11: +1 кучка → аптечка');
  });

  test('меняется и игрушка — в строке обе части, неизменившаяся часть не упоминается', () => {
    const before = world();
    const after = withFunnel(before, [fun('a1', '2026-11-03', 3, 2)]); // длинные дотянули, качественные упали
    const { days } = effectsOf(before, after);
    expect(days).toEqual([{ group: 'СР1', date: '2026-11-03', before: '+1 кучка, игрушка', after: 'аптечка, нет игрушки' }]);
  });

  test('число изменилось, а итог дня тот же — строки нет', () => {
    const before = world();
    const after = withFunnel(before, [fun('a1', '2026-11-03', 9, 0)]);
    expect(effectsOf(before, after).days).toEqual([]);
  });

  test('в «прошлых днях» только дни, оценённые до загрузки; впервые оцениваемый день — не переписанный', () => {
    const before = world({ funnelThrough: '2026-11-02' });
    const after = withFunnel(before, [fun('a1', '2026-11-03', 4, 2), fun('b1', '2026-11-03', 0, 0)], '2026-11-03');
    expect(effectsOf(before, after).days).toEqual([]);
  });

  test('воронка загружена раньше прежней: день перестал оцениваться — «воронка за день не загружена»', () => {
    const before = world();
    const after = withFunnel(before, [], '2026-11-02');
    const { days } = effectsOf(before, after);
    expect(days).toEqual([
      { group: 'СР1', date: '2026-11-03', before: '+1 кучка, игрушка', after: 'воронка за день не загружена' },
      { group: 'СР2', date: '2026-11-03', before: 'аптечка, игрушка', after: 'воронка за день не загружена' },
    ]);
  });

  test('дни по порядку: сначала дата, потом группа', () => {
    const before = world();
    const after = withFunnel(before, [fun('a1', '2026-11-02', 0, 0), fun('b1', '2026-11-02', 0, 0), fun('a1', '2026-11-03', 4, 2), fun('b1', '2026-11-03', 0, 2)]);
    expect(effectsOf(before, after).days.map((d) => `${d.date} ${d.group}`)).toEqual(['2026-11-02 СР1', '2026-11-02 СР2', '2026-11-03 СР1', '2026-11-03 СР2']);
  });

  test('«Сейчас станет»: питомцы, у которых что-то изменилось, в том виде, как в превью норм', () => {
    const before = world();
    const after = withFunnel(before, [fun('a1', '2026-11-03', 4, 2)]);
    const { now } = effectsOf(before, after);
    expect(now.map((c) => c.group)).toEqual(['СР1']);
    expect(describeChange(now[0])).toBe('СР1: аптечки 1 → 2; кучки 1 → 0');
  });

  test('правка с base 2, в файле после загрузки 3 — в stale; до загрузки её значение «из файла» совпадало', () => {
    const before = world({ funnel: [fun('a1', '2026-11-03', 4, 2), fun('b1', '2026-11-03', 4, 2)], corrections: [corr(1, '2026-11-03', 'a1', 'long', 1, 2)] });
    const after = withFunnel(before, [fun('a1', '2026-11-03', 4, 3)]);
    const { stale } = effectsOf(before, after);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ c: { id: 1, base: 2 }, group: 'СР1', fileNow: 3, stale: true });
  });

  test('правка за день, которого в загруженной воронке ещё нет, не устарела; правка с совпавшим base — тоже', () => {
    const before = world({ funnelThrough: '2026-11-02', corrections: [corr(1, '2026-11-03', 'a1', 'long', 1, 1), corr(2, '2026-11-02', 'a1', 'quality', 1, 4)] });
    const after = withFunnel(before, [fun('a1', '2026-11-03', 4, 1)], '2026-11-03');
    expect(effectsOf(before, after).stale).toEqual([]);
  });

  test('правка оплат устаревает, когда в файле оплат появляется счёт сотрудника', () => {
    const pay = (invoice: string) => ({ date: '2026-11-03', group: 'СР1' as const, author: 'Тест Альфов', invoice });
    const before = world({ payments: [pay('P1')], corrections: [corr(1, '2026-11-03', 'a1', 'payments', 1, 1)] });
    const after: Snapshot = { ...before, payments: [pay('P1'), pay('P2')] };
    expect(effectsOf(before, after).stale.map((v) => [v.c.id, v.fileNow])).toEqual([[1, 2]]);
  });

  test('группа, в которой до загрузки никого не было, а после появился сотрудник, — в списке дней', () => {
    const before = world();
    const after: Snapshot = {
      ...withFunnel(before, [fun('c1', '2026-11-02', 4, 2), fun('c1', '2026-11-03', 4, 2)]),
      staff: [...before.staff, emp('c1', 'Тест Гаммов', 'СР3')],
    };
    const { days } = effectsOf(before, after);
    expect(days.map((d) => `${d.date} ${d.group} → ${d.after}`)).toEqual(['2026-11-02 СР3 → аптечка, игрушка', '2026-11-03 СР3 → аптечка, игрушка']);
  });

  test('ничего не изменилось — три пустых списка', () => {
    const before = world({ corrections: [corr(1, '2026-11-03', 'a1', 'long', 1, 1)] });
    expect(effectsOf(before, { ...before })).toEqual({ days: [], now: [], stale: [] });
  });

  test('снимки не меняются', () => {
    const before = world({ corrections: [corr(1, '2026-11-03', 'a1', 'long', 1, 2)] });
    const after = withFunnel(before, [fun('a1', '2026-11-03', 4, 3)]);
    const copy = [structuredClone(before), structuredClone(after)];
    effectsOf(before, after);
    expect([before, after]).toEqual(copy);
  });
});
