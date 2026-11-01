import { describe, expect, test } from 'vitest';
import { checkNewPin } from './pinForm';

describe('checkNewPin: новый админ-PIN', () => {
  test.each([
    ['', '', 'PIN — от 4 до 12 цифр'],
    ['123', '123', 'PIN — от 4 до 12 цифр'],
    ['12a45', '12a45', 'PIN — от 4 до 12 цифр'],
    ['1234567890123', '1234567890123', 'PIN — от 4 до 12 цифр'],
    ['48151', '48152', 'PIN в двух полях не совпадают'],
  ])('«%s» / «%s» — ошибка', (a, b, error) => {
    expect(checkNewPin(a, b)).toBe(error);
  });

  test('4–12 цифр и совпадают — можно', () => {
    expect(checkNewPin('4815', '4815')).toBeNull();
    expect(checkNewPin('481516234200', '481516234200')).toBeNull();
  });
});
