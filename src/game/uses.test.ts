import { describe, expect, test } from 'vitest';
import type { SnapshotOverride } from '@/data/api';
import { newUses } from './uses';

const row = (id: number, kind: SnapshotOverride['kind'], group: SnapshotOverride['group'] = 'СР1'): SnapshotOverride => ({
  id, date: '2026-11-12', group, kind, delta: kind.startsWith('use') ? 1 : 2,
});
const ids = (rows: SnapshotOverride[]) => rows.map((r) => r.id);

describe('newUses', () => {
  test('первый снимок ничего не показывает и запоминает наибольший id расхода', () => {
    const r = newUses(null, [row(1, 'useToy'), row(4, 'useMedkit'), row(2, 'useToy')]);
    expect(r.uses).toEqual([]);
    expect(r.max).toBe(4);
  });

  test('без расходов максимум 0, а новая запись после него показывается', () => {
    const first = newUses(null, [row(1, 'piles')]);
    expect(first).toEqual({ uses: [], max: 0 });
    expect(ids(newUses(first.max, [row(1, 'piles'), row(2, 'useToy')]).uses)).toEqual([2]);
  });

  test('новые расходы отдаются по порядку id, как бы ни лежали в снимке', () => {
    const r = newUses(2, [row(5, 'useToy'), row(1, 'useToy'), row(3, 'useMedkit'), row(2, 'useToy')]);
    expect(ids(r.uses)).toEqual([3, 5]);
    expect(r.max).toBe(5);
  });

  test('ручные правки админа не показываются и не двигают максимум', () => {
    const r = newUses(3, [row(4, 'piles'), row(5, 'medkits'), row(6, 'toys'), row(7, 'useToy')]);
    expect(ids(r.uses)).toEqual([7]);
    expect(r.max).toBe(7);
    expect(newUses(3, [row(4, 'piles'), row(9, 'toys')])).toEqual({ uses: [], max: 3 });
  });

  test('уже показанные расходы не повторяются, максимум не уменьшается', () => {
    expect(newUses(5, [row(4, 'useToy'), row(5, 'useMedkit')])).toEqual({ uses: [], max: 5 });
    expect(newUses(5, [])).toEqual({ uses: [], max: 5 });
  });

  test('пять новых расходов за снимок — только последние три', () => {
    const r = newUses(0, [1, 2, 3, 4, 5].map((id) => row(id, 'useToy')));
    expect(ids(r.uses)).toEqual([3, 4, 5]);
    expect(r.max).toBe(5);
  });
});
