import { describe, expect, test } from 'vitest';
import { defaultConfig as cfg } from './config';
import { evaluateDay, type FunnelDay } from './evaluate';
import type { Absence, Employee } from './staff';

const emp = (id: string, o: Partial<Employee> = {}): Employee => ({
  id, name: id, shortName: id, group: 'СР1', hireDate: null, fireDate: null,
  baseLevel: 'experienced', hiddenFromRating: false, transfers: [], ...o,
});
const f = (employeeId: string, quality: number, long: number, date = '2026-11-03'): FunnelDay => ({ employeeId, date, quality, long });
const D = '2026-11-03';

describe('evaluateDay', () => {
  test('2 опытных: норма 10 качественных и 6 длинных', () => {
    const r = evaluateDay('СР1', D, [emp('a'), emp('b')], [], [], cfg);
    expect(r.normQuality).toBe(10);
    expect(r.normLong).toBe(6);
  });
  test('опытный + новичок недели 2: 7 и 4', () => {
    const staff = [emp('a'), emp('b', { hireDate: '2026-11-02', baseLevel: 'rookie1' })];
    // 11-09: b — rookie2 (2/1)
    const r = evaluateDay('СР1', '2026-11-09', staff, [], [], cfg);
    expect(r.normQuality).toBe(7);
    expect(r.normLong).toBe(4);
  });
  test('норма выполнена по группе в сумме', () => {
    const staff = [emp('a'), emp('b')];
    const r = evaluateDay('СР1', D, staff, [], [f('a', 8, 6), f('b', 2, 0)], cfg);
    expect(r.factQuality).toBe(10);
    expect(r.factLong).toBe(6);
    expect(r.qualityMet).toBe(true);
    expect(r.longMet).toBe(true);
  });
  test('не выполнена на единицу', () => {
    const r = evaluateDay('СР1', D, [emp('a')], [], [f('a', 5, 2)], cfg);
    expect(r.qualityMet).toBe(true);
    expect(r.longMet).toBe(false);
  });
  test('отпускник не входит ни в норму, ни в факт', () => {
    const abs: Absence[] = [{ employeeId: 'b', kind: 'vacation', from: D, to: D }];
    const r = evaluateDay('СР1', D, [emp('a'), emp('b')], abs, [f('a', 5, 3), f('b', 9, 9)], cfg);
    expect(r.normQuality).toBe(5);
    expect(r.factQuality).toBe(5);
    expect(r.qualityMet && r.longMet).toBe(true);
  });
  test('сотрудник другой группы и перевод', () => {
    const staff = [emp('a'), emp('b', { group: 'СР2', transfers: [{ date: D, group: 'СР1' }] })];
    expect(evaluateDay('СР1', D, staff, [], [], cfg).normQuality).toBe(10);
    expect(evaluateDay('СР2', D, staff, [], [], cfg).normQuality).toBe(0);
  });
  test('данные воронки за другой день игнорируются', () => {
    const r = evaluateDay('СР1', D, [emp('a')], [], [f('a', 9, 9, '2026-11-02')], cfg);
    expect(r.factQuality).toBe(0);
  });
  test('норма 0 (пустая группа) — ничего не выполнено', () => {
    const r = evaluateDay('СР9', D, [emp('a')], [], [], cfg);
    expect(r.normQuality).toBe(0);
    expect(r.longMet).toBe(false);
    expect(r.qualityMet).toBe(false);
  });
  test('только новичок недели 1: длинных не требуется', () => {
    const staff = [emp('a', { hireDate: '2026-11-02', baseLevel: 'rookie1' })];
    const r = evaluateDay('СР1', '2026-11-03', staff, [], [f('a', 1, 0)], cfg);
    expect(r.longRequired).toBe(false);
    expect(r.longMet).toBe(false);
    expect(r.qualityMet).toBe(true);
  });
});
