import { describe, expect, test } from 'vitest';
import { ruNum } from './format';

describe('ruNum', () => {
  test('дробное — с запятой, целое — без «,0»', () => {
    expect(ruNum(1.5)).toBe('1,5');
    expect(ruNum(2)).toBe('2');
    expect(ruNum(0.25)).toBe('0,25');
    expect(ruNum(0)).toBe('0');
    expect(ruNum(10.5)).toBe('10,5');
  });
});
