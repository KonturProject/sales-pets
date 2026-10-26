import { describe, expect, test } from 'vitest';
import { defaultConfig } from '@/engine/config';
import { configFormOf, configPatch, type ConfigCurrent, type ConfigForm } from './configForm';

const current: ConfigCurrent = { ...defaultConfig, dailyNorm: 4 };

const patch = (over: Partial<ConfigForm> = {}) => configPatch({ ...configFormOf(current), ...over }, current);

describe('configFormOf', () => {
  test('поля заполнены текущими значениями строками', () => {
    const form = configFormOf(current);
    expect(form.maxPiles).toBe('5');
    expect(form.dailyNorm).toBe('4');
    expect(form.norms.experienced).toEqual({ quality: '5', long: '3' });
    expect(form.stageThresholds).toHaveLength(15);
    expect(form.stageThresholds[0]).toBe('6');
  });
});

describe('configPatch', () => {
  test('ничего не менялось — ошибка, а не пустой запрос', () => {
    expect(patch()).toEqual({ error: 'Ничего не изменено' });
  });

  test('уходит только изменённое поле', () => {
    expect(patch({ maxPiles: '6' })).toEqual({ maxPiles: 6 });
    expect(patch({ dailyNorm: '6', sickPilesAbove: '3' })).toEqual({ dailyNorm: 6, sickPilesAbove: 3 });
  });

  test('нормы: только изменённые поля изменённых уровней', () => {
    const form = configFormOf(current);
    expect(patch({ norms: { ...form.norms, experienced: { quality: '1', long: '3' } } })).toEqual({
      norms: { experienced: { quality: 1 } },
    });
    expect(patch({
      norms: { ...form.norms, rookie1: { quality: '1', long: '2' }, rookie2: { quality: '3', long: '1' } },
    })).toEqual({ norms: { rookie1: { long: 2 }, rookie2: { quality: 3 } } });
  });

  test('пороги стадий: при изменении уходят все 15', () => {
    const thresholds = configFormOf(current).stageThresholds.slice();
    thresholds[14] = '160';
    expect(patch({ stageThresholds: thresholds })).toEqual({ stageThresholds: [...defaultConfig.stageThresholds.slice(0, 14), 160] });
  });

  test('пороги не по возрастанию — ошибка с номером порога, равные тоже', () => {
    const equal = configFormOf(current).stageThresholds.slice();
    equal[0] = '10';
    expect(patch({ stageThresholds: equal })).toMatchObject({ error: expect.stringContaining('Порог 2') });
    const down = configFormOf(current).stageThresholds.slice();
    down[7] = '40';
    expect(patch({ stageThresholds: down })).toMatchObject({ error: expect.stringContaining('Порог 8') });
  });

  test('не целое число или пусто — ошибка с названием поля', () => {
    for (const bad of ['', '  ', 'abc', '2.5', '1e3', '--1']) {
      expect(patch({ maxPiles: bad }), JSON.stringify(bad)).toMatchObject({ error: expect.stringContaining('Кучек') });
    }
    expect(patch({ norms: { ...configFormOf(current).norms, rookie2: { quality: 'x', long: '1' } } }))
      .toMatchObject({ error: expect.stringContaining('Новичок 2') });
    const thresholds = configFormOf(current).stageThresholds.slice();
    thresholds[3] = '';
    expect(patch({ stageThresholds: thresholds })).toMatchObject({ error: expect.stringContaining('Порог 4') });
  });

  test('пробелы по краям не мешают; диапазон проверяет сервер, клиент его пропускает', () => {
    expect(patch({ maxPiles: ' 7 ' })).toEqual({ maxPiles: 7 });
    expect(patch({ maxPiles: '99' })).toEqual({ maxPiles: 99 });
    expect(patch({ maxPiles: '-1' })).toEqual({ maxPiles: -1 });
  });
});
