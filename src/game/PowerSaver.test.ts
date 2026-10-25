import { describe, expect, test } from 'vitest';
import { modeFor } from './PowerSaver';

describe('режим экономии', () => {
  const now = 1_000_000;
  test('видимая вкладка с недавним вводом — active', () => {
    expect(modeFor(now, now - 5_000, false)).toBe('active');
  });
  test('видимая вкладка без ввода дольше порога — ambient (монитор на стене не засыпает)', () => {
    expect(modeFor(now, now - 60_000, false)).toBe('ambient');
    expect(modeFor(now, now - 10 * 60 * 60_000, false)).toBe('ambient');
  });
  test('скрытая вкладка — idle, независимо от ввода', () => {
    expect(modeFor(now, now, true)).toBe('idle');
  });
});
