import { describe, expect, it } from 'vitest';
import type { SnapshotOverride } from '@/data/api';
import type { PetState } from '@/engine/pet';
import { TOYS, toyForRoom, toyKindFor, toyOfDay } from './toys';

const TODAY = '2026-11-12';

const row = (id: number, o: Partial<SnapshotOverride> = {}): SnapshotOverride => ({
  id, date: TODAY, group: 'СР1', kind: 'useToy', delta: -1, ...o,
});

const pet = (o: Partial<PetState> = {}): PetState => ({
  alive: true, generation: 0, totalPayments: 12, phase: 'pet', stage: 2, planPercent: 30,
  medkits: 0, toys: 0, piles: 0, mood: 'ok', satiety: 0.5, noPayDays: 0, ...o,
});

describe('TOYS и toyKindFor', () => {
  it('пять игрушек в порядке спеки, у каждой своя игра', () => {
    expect(TOYS.map((t) => `${t.kind}/${t.play}`)).toEqual(['bear/hug', 'duck/bounce', 'top/spin', 'cube/roll', 'hedgehog/roll']);
  });

  it('игрушка по id расхода: id % 5', () => {
    expect(toyKindFor(7)).toBe('top');
    expect(toyKindFor(5)).toBe('bear');
    expect(toyKindFor(14)).toBe('hedgehog');
  });
});

describe('toyOfDay', () => {
  it('без расходов игрушек — null', () => {
    expect(toyOfDay([], 'СР1', TODAY)).toBeNull();
  });

  it('последняя по id строка useToy группы за сегодня, даже если в массиве она не последняя', () => {
    const rows = [row(11), row(21), row(16)];
    expect(toyOfDay(rows, 'СР1', TODAY)).toEqual({ id: 21, kind: 'duck' });
  });

  it('другие группы, другие даты и аптечки не считаются', () => {
    const rows = [
      row(3),
      row(40, { group: 'СР2' }),
      row(41, { date: '2026-11-11' }),
      row(42, { kind: 'useMedkit' }),
      row(43, { kind: 'toys', delta: 1 }),
    ];
    expect(toyOfDay(rows, 'СР1', TODAY)).toEqual({ id: 3, kind: 'cube' });
    expect(toyOfDay(rows, 'СР3', TODAY)).toBeNull();
    expect(toyOfDay([row(42, { kind: 'useMedkit' })], 'СР1', TODAY)).toBeNull();
  });
});

describe('toyForRoom', () => {
  const toy = { id: 7, kind: 'top' as const };

  it('живой вылупившийся питомец получает игрушку', () => {
    expect(toyForRoom(toy, pet())).toBe('top');
  });

  it('у яйца и погибшего игрушки нет; без игрушки дня — null', () => {
    expect(toyForRoom(toy, pet({ phase: 'egg2', stage: 0 }))).toBeNull();
    expect(toyForRoom(toy, pet({ alive: false, mood: 'dead' }))).toBeNull();
    expect(toyForRoom(null, pet())).toBeNull();
  });
});
