import { describe, expect, test } from 'vitest';
import { defaultConfig as current } from '@/engine/config';
import { configFormOf, configPatch, type ConfigForm } from './configForm';


const patch = (over: Partial<ConfigForm> = {}) => configPatch({ ...configFormOf(current), ...over }, current);

describe('configFormOf', () => {
  test('поля заполнены текущими значениями строками', () => {
    const form = configFormOf(current);
    expect(form.maxPiles).toBe('5');
    expect(form).not.toHaveProperty('dailyNorm');
    expect(form.norms.experienced).toEqual({ quality: '5', long: '3', payments: '0,4' });
    expect(form.stageThresholds).toEqual(['25', '50', '75', '100']);
  });

  test('дробные нормы — с запятой, целые без «,0»', () => {
    const cfg = { ...current, norms: { ...current.norms, rookie1: { quality: 1.5, long: 0.25, payments: 2 } } };
    expect(configFormOf(cfg).norms.rookie1).toEqual({ quality: '1,5', long: '0,25', payments: '2' });
  });
});

describe('configPatch с датой', () => {
  const at = (from: string, over: Partial<ConfigForm> = {}) => configPatch({ ...configFormOf(current), ...over }, current, from);

  test('в пределах дат игры уходит то же, что и без даты', () => {
    expect(at('2026-11-09', { maxPiles: '3' })).toEqual({ maxPiles: 3 });
    expect(at(current.startDate, { maxPiles: '3' })).toEqual({ maxPiles: 3 });
    expect(at(current.endDate, { maxPiles: '3' })).toEqual({ maxPiles: 3 });
  });

  test('дата не в формате yyyy-MM-dd или вне дат игры — ошибка', () => {
    for (const from of ['', '9.11.2026', '2026-11-9', 'x', '2026-11-01', '2026-11-23']) {
      expect(at(from, { maxPiles: '3' }), from).toMatchObject({ error: expect.stringContaining('Дата') });
    }
  });

  test('пороги стадий с датой не меняются: ошибка про всю игру', () => {
    const thresholds = configFormOf(current).stageThresholds.slice();
    thresholds[3] = '160';
    expect(at('2026-11-09', { stageThresholds: thresholds })).toMatchObject({ error: expect.stringContaining('всю игру') });
  });

  test('ничего не изменилось относительно значений на дату — ошибка, а не пустой запрос', () => {
    expect(at('2026-11-09')).toEqual({ error: 'Ничего не изменено' });
  });
});

describe('configPatch', () => {
  test('ничего не менялось — ошибка, а не пустой запрос', () => {
    expect(patch()).toEqual({ error: 'Ничего не изменено' });
  });

  test('уходит только изменённое поле', () => {
    expect(patch({ maxPiles: '6' })).toEqual({ maxPiles: 6 });
    expect(patch({ boredomBelow: '2', sickPilesAbove: '3' })).toEqual({ boredomBelow: 2, sickPilesAbove: 3 });
  });

  test('нормы: только изменённые поля изменённых уровней', () => {
    const form = configFormOf(current);
    expect(patch({ norms: { ...form.norms, experienced: { ...form.norms.experienced, quality: '1' } } })).toEqual({
      norms: { experienced: { quality: 1 } },
    });
    expect(patch({
      norms: { ...form.norms, rookie1: { ...form.norms.rookie1, long: '2' }, rookie2: { ...form.norms.rookie2, quality: '3' } },
    })).toEqual({ norms: { rookie1: { long: 2 }, rookie2: { quality: 3 } } });
  });

  test('норма оплат в день: запятая или точка, до двух знаков', () => {
    const form = configFormOf(current);
    const pays = (text: string) => patch({ norms: { ...form.norms, experienced: { ...form.norms.experienced, payments: text } } });
    expect(pays('0,5')).toEqual({ norms: { experienced: { payments: 0.5 } } });
    expect(pays(' 0.57 ')).toEqual({ norms: { experienced: { payments: 0.57 } } });
    expect(pays('2')).toEqual({ norms: { experienced: { payments: 2 } } });
    expect(pays('0.4')).toEqual({ error: 'Ничего не изменено' });
    for (const bad of ['', 'x', '0,123', '-1', '1,2,3']) {
      expect(pays(bad), bad).toMatchObject({ error: expect.stringContaining('Опытный, оплат в день') });
    }
  });

  test('качественные и длинные: «1,5» и «0.25» принимаются, как оплаты', () => {
    const form = configFormOf(current);
    const norm = (f: 'quality' | 'long', text: string) =>
      patch({ norms: { ...form.norms, rookie2: { ...form.norms.rookie2, [f]: text } } });
    expect(norm('long', '1,5')).toEqual({ norms: { rookie2: { long: 1.5 } } });
    expect(norm('quality', ' 0.25 ')).toEqual({ norms: { rookie2: { quality: 0.25 } } });
    expect(norm('quality', '2')).toEqual({ error: 'Ничего не изменено' });
    for (const [f, title] of [['quality', 'качественные'], ['long', 'длинные']] as const) {
      for (const bad of ['1,555', '', 'x', '-1', '1,2,3']) {
        expect(norm(f, bad), `${f} ${bad}`).toMatchObject({ error: expect.stringContaining(`Новичок 2, ${title}`) });
      }
    }
  });

  test('пороги стадий: при изменении уходят все 4', () => {
    const thresholds = configFormOf(current).stageThresholds.slice();
    thresholds[3] = '160';
    expect(patch({ stageThresholds: thresholds })).toEqual({ stageThresholds: [25, 50, 75, 160] });
  });

  test('пороги не по возрастанию — ошибка с номером порога, равные тоже', () => {
    const equal = configFormOf(current).stageThresholds.slice();
    equal[0] = '50';
    expect(patch({ stageThresholds: equal })).toMatchObject({ error: 'Стадия 3: процент должен быть больше, чем у стадии 2' });
    const down = configFormOf(current).stageThresholds.slice();
    down[3] = '40';
    expect(patch({ stageThresholds: down })).toMatchObject({ error: expect.stringContaining('Стадия 5') });
  });

  test('не целое число или пусто — ошибка с названием поля', () => {
    for (const bad of ['', '  ', 'abc', '2.5', '1e3', '--1']) {
      expect(patch({ maxPiles: bad }), JSON.stringify(bad)).toMatchObject({ error: expect.stringContaining('Кучек') });
    }
    expect(patch({ norms: { ...configFormOf(current).norms, rookie2: { quality: 'x', long: '1', payments: '0,2' } } }))
      .toMatchObject({ error: expect.stringContaining('Новичок 2') });
    const thresholds = configFormOf(current).stageThresholds.slice();
    thresholds[3] = '';
    expect(patch({ stageThresholds: thresholds })).toMatchObject({ error: 'Стадия 5, %: введите целое число' });
  });

  test('пробелы по краям не мешают; диапазон проверяет сервер, клиент его пропускает', () => {
    expect(patch({ maxPiles: ' 7 ' })).toEqual({ maxPiles: 7 });
    expect(patch({ maxPiles: '99' })).toEqual({ maxPiles: 99 });
    expect(patch({ maxPiles: '-1' })).toEqual({ maxPiles: -1 });
  });
});
