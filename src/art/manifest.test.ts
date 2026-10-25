import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { GROUPS } from '@/engine/types';
import { ART } from './manifest';

describe('манифест ассетов', () => {
  const paths = [
    ART.room, ART.nest, ART.pile, ART.flies, ART.medkit, ART.toy, ART.grave,
    ...GROUPS.flatMap((g) => [...ART.eggs[g], ...ART.pets[g]]),
  ];
  test('у каждой группы три фазы яйца и хотя бы одна картинка питомца', () => {
    for (const g of GROUPS) {
      expect(ART.eggs[g]).toHaveLength(3);
      expect(ART.pets[g].length).toBeGreaterThanOrEqual(1);
    }
  });
  test.each(paths)('файл %s существует в public/', (p) => {
    expect(existsSync(`public/${p}`)).toBe(true);
  });
});
