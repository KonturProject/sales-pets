import { describe, expect, test } from 'vitest';
import type { Snapshot } from '@/data/api';
import type { Employee } from '@/engine/staff';
import { todayLine, todayTasks } from './today';

const snap = (o: Partial<Snapshot>): Snapshot => ({
  version: 1, serverNow: '2026-11-03T10:00:00+03:00', funnelThrough: null, paymentsImportedThrough: null,
  config: {}, configChanges: [], staff: [], absences: [], payments: [], provisional: [], funnel: [], overrides: [], ...o,
});

describe('todayLine: блок «Сегодня» над вкладками админки', () => {
  test('день игры: что загружено и сколько групп внесли предварительные числа сегодня', () => {
    const s = snap({
      funnelThrough: '2026-11-02',
      paymentsImportedThrough: '2026-11-02',
      provisional: [
        { date: '2026-11-03', group: 'СР1', count: 2 },
        { date: '2026-11-03', group: 'СР2', count: 0 },
        { date: '2026-11-02', group: 'СР3', count: 5 },
      ],
    });
    expect(todayLine(s)).toBe('Сегодня 03.11 · день 2 из 14 · воронка по 02.11 · оплаты из файла по 02.11 · предварительные сегодня: 2 из 6 групп');
  });

  test('до старта, пустая таблица', () => {
    expect(todayLine(snap({ serverNow: '2026-11-01T18:00:00+03:00' })))
      .toBe('Сегодня 01.11 · старт 02.11 · воронки ещё нет · оплат из файла ещё нет · предварительные сегодня: 0 из 6 групп');
  });

  test('после конца игры', () => {
    expect(todayLine(snap({ serverNow: '2026-11-23T09:00:00+03:00' }))).toContain('Сегодня 23.11 · игра окончена');
  });
});

const person = (id: string, o: Partial<Employee> = {}): Employee => ({
  id, name: id, shortName: id, group: 'СР1', hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [], ...o,
});

describe('todayTasks: что сделать сегодня', () => {
  test('первый день, штата нет: загрузить воронку — из неё добавится штат; файлов за «вчера» ещё не ждём', () => {
    expect(todayTasks(snap({ serverNow: '2026-11-02T09:00:00+03:00' }))).toEqual([
      { done: false, text: 'Штата нет: Импорт → воронка, из неё добавятся сотрудники' },
    ]);
  });

  test('03.11 утром: штат есть, воронки и оплат за 02.11 нет', () => {
    expect(todayTasks(snap({ staff: [person('a'), person('b')] }))).toEqual([
      { done: true, text: 'Штат: 2' },
      { done: false, text: 'Загрузите воронку за 02.11 (Импорт)' },
      { done: false, text: 'Загрузите оплаты за 02.11 (Импорт)' },
    ]);
  });

  test('всё загружено; новички без даты приёма — напоминание', () => {
    const s = snap({
      serverNow: '2026-11-09T09:00:00+03:00', // понедельник: «вчера» игры — пятница 06.11
      funnelThrough: '2026-11-06',
      paymentsImportedThrough: '2026-11-08',
      staff: [person('a'), person('b', { baseLevel: 'rookie1' }), person('c', { baseLevel: 'rookie2', hireDate: '2026-10-28' })],
    });
    expect(todayTasks(s)).toEqual([
      { done: true, text: 'Штат: 3' },
      { done: false, text: 'Новички без даты приёма: 1 — без даты уровень не сменится сам до конца игры (Сотрудники)' },
      { done: true, text: 'Воронка по 06.11' },
      { done: true, text: 'Оплаты из файла по 08.11' },
    ]);
  });

  test('уволенные не считаются ни в штате, ни в новичках без даты', () => {
    const s = snap({ staff: [person('a'), person('b', { baseLevel: 'rookie1', fireDate: '2026-10-31' })] });
    expect(todayTasks(s)[0]).toEqual({ done: true, text: 'Штат: 1' });
    expect(todayTasks(s).some((t) => t.text.startsWith('Новички'))).toBe(false);
  });
});
