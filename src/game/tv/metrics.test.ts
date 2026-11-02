import { describe, expect, test } from 'vitest';
import { defaultConfig as cfg } from '@/engine/config';
import type { PetState } from '@/engine/pet';
import type { RankData } from '@/engine/ranking';
import type { Employee } from '@/engine/staff';
import type { GroupCode } from '@/engine/types';
import { dayLine, freshLine, groupFunnel, partyBanner, paymentGains, tickerItems } from './metrics';

const state = (o: Partial<PetState> = {}): PetState => ({
  alive: true, generation: 0, totalPayments: 0, phase: 'egg0', stage: 0, planPercent: null,
  medkits: 0, toys: 0, piles: 0, mood: 'ok', satiety: 0, ...o,
});

describe('tickerItems: цифры табло комнаты', () => {
  test('питомец: стадия из пяти, оплаты с процентом плана, качественные и длинные', () => {
    const items = tickerItems(state({ phase: 'pet', stage: 4, totalPayments: 45, planPercent: 81 }), { quality: 132, long: 41 });
    expect(items).toEqual([
      { label: 'Стадия', value: '4', unit: '/ 5' },
      { label: 'Оплат', value: '45', unit: '81 % плана' },
      { label: 'Качественных счетов', value: '132' },
      { label: 'Длинных презентаций', value: '41' },
    ]);
  });

  test('питомец без данных воронки: только стадия и оплаты', () => {
    expect(tickerItems(state({ phase: 'pet', stage: 1, totalPayments: 6 })).map((i) => i.label)).toEqual(['Стадия', 'Оплат']);
  });

  test('плана нет (штата нет) — процент не показывается', () => {
    expect(tickerItems(state({ phase: 'pet', stage: 1, totalPayments: 6 }))[1]).toEqual({ label: 'Оплат', value: '6' });
  });

  test('яйцо: сколько оплат из пяти до вылупления', () => {
    expect(tickerItems(state({ phase: 'egg2', totalPayments: 3 }))).toEqual([{ label: 'До вылупления', value: '3', unit: 'из 5 оплат' }]);
  });

  test('надгробие: один пункт, без стадии', () => {
    const items = tickerItems(state({ alive: false, mood: 'dead', phase: 'pet', stage: 4 }));
    expect(items).toHaveLength(1);
    expect(items[0].label).not.toBe('Стадия');
  });
});

describe('groupFunnel: воронка группы с начала игры', () => {
  const emp = (id: string, group: GroupCode, transfers: Employee['transfers'] = []): Employee => ({
    id, name: id, shortName: id, group, hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers,
  });
  const rank = (o: Partial<RankData>): RankData => ({ staff: [], absences: [], payments: [], funnel: [], cfg, ...o });

  test('строки суммируются по группе сотрудника; дни после asOf не считаются', () => {
    const r = rank({
      staff: [emp('a', 'СР1'), emp('b', 'СР1'), emp('c', 'СР2')],
      funnel: [
        { employeeId: 'a', date: '2026-11-02', quality: 3, long: 1 },
        { employeeId: 'b', date: '2026-11-03', quality: 2, long: 2 },
        { employeeId: 'c', date: '2026-11-03', quality: 5, long: 0 },
        { employeeId: 'a', date: '2026-11-05', quality: 9, long: 9 },
      ],
    });
    const t = groupFunnel(r, '2026-11-03');
    expect(t['СР1']).toEqual({ quality: 5, long: 3 });
    expect(t['СР2']).toEqual({ quality: 5, long: 0 });
    expect(t['СР9']).toEqual({ quality: 0, long: 0 });
  });

  test('после перевода строки идут новой группе, до перевода — старой; чужие сотрудники пропускаются', () => {
    const r = rank({
      staff: [emp('a', 'СР1', [{ date: '2026-11-05', group: 'СР3' }])],
      funnel: [
        { employeeId: 'a', date: '2026-11-03', quality: 1, long: 0 },
        { employeeId: 'a', date: '2026-11-05', quality: 2, long: 0 },
        { employeeId: 'ghost', date: '2026-11-05', quality: 7, long: 7 },
      ],
    });
    const t = groupFunnel(r, '2026-11-20');
    expect(t['СР1'].quality).toBe(1);
    expect(t['СР3'].quality).toBe(2);
  });
});

describe('dayLine: день игры в верхней строке', () => {
  test.each([
    ['2026-11-01', 'старт 02.11'],
    ['2026-11-02', 'день 1 из 14'],
    ['2026-11-07', 'выходной · день 4 из 14'],
    ['2026-11-20', 'день 14 из 14'],
    ['2026-11-23', 'игра окончена'],
  ])('%s → %s', (asOf, want) => {
    expect(dayLine(asOf, cfg)).toBe(want);
  });
});

describe('freshLine: свежесть данных', () => {
  test('время по Москве и даты загрузки', () => {
    expect(freshLine({ at: new Date('2026-11-11T07:42:00Z'), funnelThrough: '2026-11-10', paymentsThrough: '2026-11-11' }))
      .toBe('обновлено 10:42 · воронка по 10.11 · оплаты по 11.11');
  });

  test('до первой загрузки файлов', () => {
    expect(freshLine({ at: new Date('2026-11-02T06:05:00Z'), funnelThrough: null, paymentsThrough: null }))
      .toBe('обновлено 09:05 · воронки ещё нет · оплат из файла ещё нет');
  });
});

describe('paymentGains: новые оплаты групп между обновлениями экрана', () => {
  const totals = (o: Partial<Record<GroupCode, number>> = {}): Record<GroupCode, number> => ({ СР1: 0, СР2: 0, СР3: 0, СР5: 0, СР6: 0, СР9: 0, ...o });

  test('первое обновление — загрузка, а не новая оплата', () => {
    expect(paymentGains(null, totals({ СР1: 5 }))).toEqual([]);
  });

  test('прирост по группам — по убыванию; без изменений и уменьшение не считаются', () => {
    expect(paymentGains(totals({ СР1: 5, СР2: 4, СР3: 3 }), totals({ СР1: 6, СР2: 2, СР3: 6 }))).toEqual([
      { group: 'СР3', gain: 3 },
      { group: 'СР1', gain: 1 },
    ]);
  });
});

describe('partyBanner: плашка праздника', () => {
  test.each([
    [1, 'СР3: +1 оплата! Все на праздник'],
    [2, 'СР3: +2 оплаты! Все на праздник'],
    [5, 'СР3: +5 оплат! Все на праздник'],
    [21, 'СР3: +21 оплата! Все на праздник'],
    [12, 'СР3: +12 оплат! Все на праздник'],
  ])('одна группа, +%i', (gain, text) => {
    expect(partyBanner([{ group: 'СР3', gain }])).toBe(text);
  });

  test('несколько групп — одной строкой', () => {
    expect(partyBanner([{ group: 'СР1', gain: 3 }, { group: 'СР2', gain: 1 }])).toBe('Новые оплаты: СР1 +3 · СР2 +1 · все на праздник');
  });
});
