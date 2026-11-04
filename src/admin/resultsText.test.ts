import { describe, expect, test } from 'vitest';
import type { DayResult } from '@/engine/evaluate';
import type { PetState } from '@/engine/pet';
import {
  cellText, correctionLine, dayLabel, editorCaption, employeeMarks, nowLines, num, outcomeLines, shortDate, signed, staleLine, staleText,
  unassignedLines,
} from './resultsText';
import type { Cell, Outcome } from './results';

const cell = (over: Partial<Cell> = {}): Cell => ({ fact: 0, plan: 0, corrected: 0, stale: false, ...over });
const result = (over: Partial<DayResult> = {}): DayResult => ({
  group: 'СР1', date: '2026-11-03', normQuality: 4, normLong: 1.5, factQuality: 5, factLong: 2,
  longRequired: true, longMet: true, qualityMet: true, ...over,
});
const outcome = (over: Partial<DayResult> = {}, appliesOn: string | null = '2026-11-05'): Outcome => {
  const r = result(over);
  return { evaluated: true, result: r, medkit: r.longMet, pile: r.longRequired && !r.longMet, pileRemoved: r.longMet, toy: r.qualityMet, appliesOn };
};
const pet = (over: Partial<PetState> = {}): PetState => ({
  alive: true, generation: 1, totalPayments: 9, phase: 'pet', stage: 3, planPercent: 40, medkits: 1, toys: 2, piles: 3,
  mood: 'ok', satiety: 0.5, noPayDays: 0, ...over,
});

describe('числа и даты', () => {
  test('дробное с запятой, минус типографский', () => {
    expect(num(10.5)).toBe('10,5');
    expect(num(3)).toBe('3');
    expect(num(-2)).toBe('−2');
    expect(signed(1)).toBe('+1');
    expect(signed(-2)).toBe('−2');
    expect(signed(1.5)).toBe('+1,5');
    expect(signed(0)).toBe('0');
  });

  test('короткая дата и подпись дня с днём недели', () => {
    expect(shortDate('2026-11-03')).toBe('03.11');
    expect(dayLabel({ date: '2026-11-11', working: true })).toBe('11.11, ср');
    expect(dayLabel({ date: '2026-11-07', working: false })).toBe('07.11, сб — выходной');
  });
});

describe('cellText', () => {
  test('факт / план с запятой; факт не меньше плана — ✓', () => {
    expect(cellText(cell({ fact: 11, plan: 10.5 }))).toMatchObject({ text: '11 / 10,5', verdict: 'ok' });
    expect(cellText(cell({ fact: 9, plan: 10.5 }))).toMatchObject({ text: '9 / 10,5', verdict: 'bad' });
    expect(cellText(cell({ fact: 3, plan: 3 }))).toMatchObject({ verdict: 'ok' });
  });

  test('сравнение в сотых: 0,1 + 0,2 не мешает ✓', () => {
    expect(cellText(cell({ fact: 0.3, plan: 0.1 + 0.2 })).verdict).toBe('ok');
  });

  test('плана нет — «—» и ни ✓, ни ✗', () => {
    expect(cellText(cell({ fact: 4, plan: null }))).toMatchObject({ text: '4 / —', verdict: null });
  });

  test('отметки: выходные, правки, устаревшая правка', () => {
    const t = cellText(cell({ fact: 4, plan: 1, weekend: 2, corrected: -1, stale: true }));
    expect(t).toMatchObject({ weekend: 'из них 2 в выходные', corrected: 'правки −1', stale: true });
    expect(cellText(cell({ weekend: 0 }))).toMatchObject({ weekend: null, corrected: null, stale: false });
  });
});

describe('outcomeLines', () => {
  test('длинные выполнены: аптечка и −1 кучка с причиной; игрушка', () => {
    expect(outcomeLines(outcome({ factLong: 11, normLong: 10.5, factQuality: 5, normQuality: 4 }))).toEqual([
      'Аптечка, −1 кучка (длинные 11 из 10,5)', 'игрушка (качественные 5 из 4)', 'с 05.11',
    ]);
  });

  test('длинные не добраны: +1 кучка; качественные не добраны: нет игрушки', () => {
    expect(outcomeLines(outcome({ factLong: 9, normLong: 10.5, longMet: false, factQuality: 3, normQuality: 4, qualityMet: false }))).toEqual([
      '+1 кучка (длинные 9 из 10,5)', 'нет игрушки (качественные 3 из 4)', 'с 05.11',
    ]);
  });

  test('нормы длинных нет: кучка и аптечка не начисляются; нормы качественных нет: нет игрушки', () => {
    expect(outcomeLines(outcome({ normLong: 0, longRequired: false, longMet: false, normQuality: 0, qualityMet: false }, null))).toEqual([
      'длинные: нормы нет', 'нет игрушки (качественные: нормы нет)',
    ]);
  });

  test('день не оценивается: выходной или воронка не загружена', () => {
    expect(outcomeLines({ evaluated: false, reason: 'weekend' })).toEqual(['выходной']);
    expect(outcomeLines({ evaluated: false, reason: 'no-funnel' })).toEqual(['воронка за день не загружена']);
  });
});

describe('nowLines', () => {
  test('стадия, запасы и причина настроения', () => {
    expect(nowLines({ now: pet({ mood: 'sad' }), nowReason: 'грустит: кучек 3' })).toEqual([
      'стадия 3', 'кучек 3 · аптечек 1 · игрушек 2', 'грустит: кучек 3',
    ]);
  });

  test('яйцо и хорошее настроение', () => {
    expect(nowLines({ now: pet({ phase: 'egg1', stage: 0 }), nowReason: null })).toEqual([
      'яйцо', 'кучек 3 · аптечек 1 · игрушек 2', 'настроение в порядке',
    ]);
  });

  test('погиб — один раз', () => {
    expect(nowLines({ now: pet({ alive: false, mood: 'dead' }), nowReason: 'погиб' })).toEqual([
      'погиб', 'кучек 3 · аптечек 1 · игрушек 2',
    ]);
  });
});

describe('подписи сотрудника и группы', () => {
  test('отметки: отпуск, больничный, другое, не в рейтинге, не входит в итог', () => {
    expect(employeeMarks({ absence: null, hidden: false, inGroupTotal: true })).toEqual([]);
    expect(employeeMarks({ absence: 'vacation', hidden: false, inGroupTotal: false })).toEqual(['отпуск', 'не входит в итог группы']);
    expect(employeeMarks({ absence: 'sick', hidden: true, inGroupTotal: false })).toEqual(['больничный', 'не в рейтинге', 'не входит в итог группы']);
    expect(employeeMarks({ absence: 'other', hidden: false, inGroupTotal: false })[0]).toBe('отсутствует');
  });

  test('подпись редактора: «правки» только когда они есть', () => {
    expect(editorCaption(3, 0)).toBe('из файла 3');
    expect(editorCaption(3, 1)).toBe('из файла 3, правки +1');
    expect(editorCaption(0, -2)).toBe('из файла 0, правки −2');
  });

  test('не разнесено: строка только при ненулевой разнице, «авторы не из штата» — только если есть', () => {
    expect(unassignedLines({ payments: 0, unmatched: 0 })).toEqual([]);
    expect(unassignedLines({ payments: 2, unmatched: 0 })).toEqual(['не разнесено по сотрудникам: 2']);
    expect(unassignedLines({ payments: 3, unmatched: 1 })).toEqual(['не разнесено по сотрудникам: 3', 'из них авторы не из штата: 1']);
    expect(unassignedLines({ payments: -1, unmatched: 0 })).toEqual(['не разнесено по сотрудникам: −1']);
  });
});

describe('staleText', () => {
  const view = (over: Record<string, unknown> = {}) => ({
    c: { id: 1, date: '2026-11-03', employeeId: 'a1', kind: 'long' as const, delta: 1, base: 2 }, fileNow: 3, stale: true, ...over,
  });

  test('текст из спеки: сделана при 2, теперь 3', () => {
    expect(staleText(view())).toBe('правка +1 сделана при 2 в файле, теперь в файле 3 — проверьте, не пришёл ли счёт сам');
    expect(staleText(view({ c: { id: 1, date: '2026-11-03', employeeId: 'a1', kind: 'payments', delta: -2, base: 5 }, fileNow: 0 })))
      .toContain('правка −2 сделана при 5 в файле, теперь в файле 0');
  });

  test('не устарела — пусто', () => {
    expect(staleText(view({ stale: false }))).toBe('');
    expect(staleText(view({ fileNow: null, stale: false }))).toBe('');
  });
});

describe('correctionLine и staleLine: правки в разборе загрузки', () => {
  const view = (over: Record<string, unknown> = {}) => ({
    c: { id: 1, date: '2026-11-03', employeeId: 'a1', kind: 'long' as const, delta: 1, base: 2 },
    group: 'СР3' as const, name: 'Тест Иванов', fileNow: 3, stale: true, ...over,
  });

  test('устаревшая правка — строкой из спеки: дата, группа, ФИО, показатель, что случилось', () => {
    expect(staleLine(view())).toBe('03.11, СР3, Тест Иванов, длинные: правка +1 сделана при 2 в файле, теперь в файле 3 — проверьте, не пришёл ли счёт сам');
  });

  test('правка ушедшего из штата — группа «—»', () => {
    expect(staleLine(view({ group: null, name: 'нет в штате' }))).toContain('03.11, —, нет в штате, длинные:');
  });

  test('правка в списке: без пометки, если не устарела, с пометкой, если устарела', () => {
    expect(correctionLine(view({ stale: false }))).toBe('03.11, СР3, Тест Иванов, длинные: +1');
    expect(correctionLine(view({ c: { id: 2, date: '2026-11-04', employeeId: 'a1', kind: 'payments', delta: -2, base: 2 }, stale: false }))).toBe('04.11, СР3, Тест Иванов, оплаты: −2');
    expect(correctionLine(view())).toBe('03.11, СР3, Тест Иванов, длинные: +1 — ⚠ правка +1 сделана при 2 в файле, теперь в файле 3 — проверьте, не пришёл ли счёт сам');
  });
});
