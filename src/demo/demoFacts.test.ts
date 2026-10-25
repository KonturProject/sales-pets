import { describe, expect, test } from 'vitest';
import { simulate } from '@/engine/pet';
import { GROUPS, type GroupCode } from '@/engine/types';
import { buildDemo, groupFacts } from './demoFacts';

const stateOf = (group: GroupCode, asOf: string) => {
  const demo = buildDemo(asOf);
  return simulate(groupFacts(demo, group, asOf), asOf, demo.cfg);
};

describe('демо-данные', () => {
  const asOf = '2026-11-12';

  test('в каждой группе 3–6 вымышленных сотрудников', () => {
    const { staff } = buildDemo(asOf);
    for (const g of GROUPS) {
      const members = staff.filter((e) => e.group === g);
      expect(members.length).toBeGreaterThanOrEqual(3);
      expect(members.length).toBeLessThanOrEqual(6);
    }
    expect(staff.every((e) => e.shortName.startsWith('Тест '))).toBe(true);
    expect(new Set(staff.map((e) => e.id)).size).toBe(staff.length);
  });

  test('шесть групп в шести разных состояниях', () => {
    expect(stateOf('СР1', asOf)).toMatchObject({ phase: 'pet', mood: 'ok', stage: 7, alive: true });
    expect(stateOf('СР2', asOf)).toMatchObject({ phase: 'egg2', mood: 'ok' });
    expect(stateOf('СР3', asOf)).toMatchObject({ phase: 'pet', mood: 'ok', stage: 1 });
    expect(stateOf('СР5', asOf)).toMatchObject({ phase: 'pet', mood: 'bored', piles: 0 });
    expect(stateOf('СР6', asOf)).toMatchObject({ phase: 'pet', mood: 'sick', piles: 5 });
    expect(stateOf('СР9', asOf)).toMatchObject({ phase: 'egg0', alive: true, generation: 1 });
  });

  test('накануне СР9 показывает надгробие', () => {
    expect(stateOf('СР9', '2026-11-11')).toMatchObject({ alive: false, mood: 'dead' });
  });

  test('аптечки и игрушки накапливаются у группы, выполняющей нормы', () => {
    const s = stateOf('СР1', asOf);
    expect(s.medkits).toBeGreaterThan(0);
    expect(s.toys).toBeGreaterThan(0);
  });

  test('детерминированный набор', () => {
    expect(buildDemo(asOf)).toEqual(buildDemo(asOf));
  });

  test('до старта игры все группы — яйца, ничего не падает', () => {
    for (const g of GROUPS) expect(stateOf(g, '2026-10-26')).toMatchObject({ phase: 'egg0', totalPayments: 0 });
  });
});
