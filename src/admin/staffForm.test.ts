import { describe, expect, test } from 'vitest';
import {
  buildAbsence, buildStaffPatch, filterStaff, formOf, parseStaffJson,
  type StaffCurrent,
} from './staffForm';

const person = (over: Partial<StaffCurrent> = {}): StaffCurrent => ({
  id: 'e1', name: 'Иванова Анна Сергеевна', shortName: 'Иванова А.', group: 'СР1', hireDate: null, fireDate: null,
  baseLevel: 'experienced', hiddenFromRating: false, transfers: [], hiddenReason: '',
  ...over,
});

describe('filterStaff', () => {
  const staff = [person(), person({ id: 'e2', name: 'Петров Пётр Петрович', shortName: 'Петров П.' })];

  test('без регистра, по ФИО и по короткому имени, лишние пробелы не мешают', () => {
    expect(filterStaff(staff, 'ИВАНОВА').map((e) => e.id)).toEqual(['e1']);
    expect(filterStaff(staff, 'пётр петр').map((e) => e.id)).toEqual(['e2']);
    expect(filterStaff(staff, '  петров   п. ').map((e) => e.id)).toEqual(['e2']);
  });

  test('пустой запрос — все, нет совпадений — пусто', () => {
    expect(filterStaff(staff, '   ')).toHaveLength(2);
    expect(filterStaff(staff, 'сидоров')).toEqual([]);
  });
});

describe('buildStaffPatch', () => {
  const patch = (current: StaffCurrent, over: Partial<ReturnType<typeof formOf>>) =>
    buildStaffPatch(current, { ...formOf(current), ...over });

  test('приём: дата приёма уходит вместе с ФИО-ключом, остальное не трогается', () => {
    expect(patch(person(), { hireDate: '2026-11-09' })).toEqual({ name: 'Иванова Анна Сергеевна', hireDate: '2026-11-09' });
  });

  test('увольнение — fireDate, отмена увольнения — fireDate: null', () => {
    expect(patch(person(), { fireDate: '2026-11-12' })).toEqual({ name: 'Иванова Анна Сергеевна', fireDate: '2026-11-12' });
    expect(patch(person({ fireDate: '2026-11-12' }), { fireDate: '' })).toEqual({ name: 'Иванова Анна Сергеевна', fireDate: null });
  });

  test('увольнение не позже приёма и дата не в формате — ошибка', () => {
    expect(patch(person({ hireDate: '2026-11-09' }), { fireDate: '2026-11-09' })).toHaveProperty('error');
    expect(patch(person(), { fireDate: '12.11.2026' })).toHaveProperty('error');
    expect(patch(person(), { hireDate: '2026-02-30' })).toHaveProperty('error');
  });

  test('ничего не изменено — ошибка, а не пустой запрос', () => {
    expect(patch(person(), {})).toEqual({ error: 'Ничего не изменено' });
  });

  test('уровень', () => {
    expect(patch(person(), { baseLevel: 'rookie1' })).toEqual({ name: 'Иванова Анна Сергеевна', baseLevel: 'rookie1' });
  });

  test('перевод: добавляется к прежним, перевод на ту же дату заменяется, порядок по дате', () => {
    const current = person({ transfers: [{ date: '2026-11-05', group: 'СР2' }, { date: '2026-11-16', group: 'СР3' }] });
    expect(patch(current, { transferDate: '2026-11-10', transferGroup: 'СР5' })).toEqual({
      name: 'Иванова Анна Сергеевна',
      transfers: [{ date: '2026-11-05', group: 'СР2' }, { date: '2026-11-10', group: 'СР5' }, { date: '2026-11-16', group: 'СР3' }],
    });
    expect(patch(current, { transferDate: '2026-11-05', transferGroup: 'СР9' })).toMatchObject({
      transfers: [{ date: '2026-11-05', group: 'СР9' }, { date: '2026-11-16', group: 'СР3' }],
    });
  });

  test('перевод без даты или без группы — ошибка; группа вне шести — ошибка', () => {
    expect(patch(person(), { transferDate: '', transferGroup: 'СР2' })).toHaveProperty('error');
    expect(patch(person(), { transferDate: '2026-11-10', transferGroup: '' })).toHaveProperty('error');
    expect(patch(person(), { transferDate: '2026-11-10', transferGroup: 'СР4' as never })).toHaveProperty('error');
  });

  test('исключение из рейтинга без причины — ошибка, с причиной — флаг и причина', () => {
    expect(patch(person(), { hiddenFromRating: true, hiddenReason: '   ' })).toHaveProperty('error');
    expect(patch(person(), { hiddenFromRating: true, hiddenReason: 'декрет' })).toEqual({
      name: 'Иванова Анна Сергеевна', hiddenFromRating: true, hiddenReason: 'декрет',
    });
  });

  test('причина длиннее 200 знаков — ошибка', () => {
    expect(patch(person(), { hiddenFromRating: true, hiddenReason: 'я'.repeat(201) })).toHaveProperty('error');
  });

  test('возврат в рейтинг шлёт только флаг; смена причины при скрытом — только причина', () => {
    const hidden = person({ hiddenFromRating: true, hiddenReason: 'декрет' });
    expect(patch(hidden, { hiddenFromRating: false })).toEqual({ name: 'Иванова Анна Сергеевна', hiddenFromRating: false });
    expect(patch(hidden, { hiddenReason: 'больничный по уходу' })).toEqual({ name: 'Иванова Анна Сергеевна', hiddenReason: 'больничный по уходу' });
  });
});

describe('parseStaffJson', () => {
  const ok = [
    { name: 'Тест Один', group: 'СР1' },
    { name: 'Тест Два', group: 'СР5', hireDate: '2026-11-09', baseLevel: 'rookie1' },
  ];

  test('корректный список проходит как есть', () => {
    expect(parseStaffJson(JSON.stringify(ok))).toEqual(ok);
  });

  test('не JSON и не список — ошибка без цитаты из файла', () => {
    const broken = parseStaffJson('{"name": "Секрет Фамилия"');
    expect(broken).toHaveProperty('error');
    expect(JSON.stringify(broken)).not.toContain('Секрет');
    expect(parseStaffJson('{"name": "Тест Один"}')).toHaveProperty('error');
    expect(parseStaffJson('[]')).toHaveProperty('error');
  });

  test('группа вне шести: ошибка с номером записи, без ФИО', () => {
    const r = parseStaffJson(JSON.stringify([ok[0], { name: 'Тест Чужой', group: 'СР4' }]));
    expect(r).toHaveProperty('error');
    const { error } = r as { error: string };
    expect(error).toContain('Запись 2');
    expect(error).not.toContain('Тест');
  });

  test('ФИО дважды (без учёта регистра и пробелов): ошибка с номерами обеих записей, без ФИО', () => {
    const r = parseStaffJson(JSON.stringify([ok[0], ok[1], { name: ' тест   один', group: 'СР2' }]));
    const { error } = r as { error: string };
    expect(error).toContain('Запись 3');
    expect(error).toContain('записи 1');
    expect(error).not.toContain('Тест');
  });

  test('без ФИО или без группы, неизвестный ключ, плохая дата или уровень — ошибка с номером', () => {
    for (const bad of [
      { group: 'СР1' },
      { name: 'Тест Три' },
      { name: 'Тест Три', group: 'СР1', salary: 1 },
      { name: 'Тест Три', group: 'СР1', hireDate: '9.11.2026' },
      { name: 'Тест Три', group: 'СР1', baseLevel: 'senior' },
      { name: 'Тест Три', group: 'СР1', hiddenFromRating: true },
    ]) {
      const { error } = parseStaffJson(JSON.stringify([ok[0], bad])) as { error: string };
      expect(error, JSON.stringify(bad)).toContain('Запись 2');
    }
  });

  test('скрытие с причиной и дата увольнения null принимаются', () => {
    const list = [{ name: 'Тест Один', group: 'СР1', hiddenFromRating: true, hiddenReason: 'декрет', fireDate: null }];
    expect(parseStaffJson(JSON.stringify(list))).toEqual(list);
  });
});

describe('buildAbsence', () => {
  test('отпуск с датами и бессрочное отсутствие (to пустой → null)', () => {
    expect(buildAbsence({ kind: 'vacation', from: '2026-11-09', to: '2026-11-13' })).toEqual({ kind: 'vacation', from: '2026-11-09', to: '2026-11-13' });
    expect(buildAbsence({ kind: 'sick', from: '2026-11-09', to: '' })).toEqual({ kind: 'sick', from: '2026-11-09', to: null });
  });

  test('нет начала, конец раньше начала, мусорная дата — ошибка', () => {
    expect(buildAbsence({ kind: 'vacation', from: '', to: '' })).toHaveProperty('error');
    expect(buildAbsence({ kind: 'vacation', from: '2026-11-09', to: '2026-11-08' })).toHaveProperty('error');
    expect(buildAbsence({ kind: 'other', from: 'вчера', to: '' })).toHaveProperty('error');
  });
});
