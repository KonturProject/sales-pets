import type { GroupCode } from '@/engine/types';

/** Ключ группы в именах файлов (латиницей). */
export const GROUP_KEY: Record<GroupCode, string> = {
  СР1: 'sr1', СР2: 'sr2', СР3: 'sr3', СР5: 'sr5', СР6: 'sr6', СР9: 'sr9',
};

const byGroup = <T>(f: (key: string) => T): Record<GroupCode, T> =>
  Object.fromEntries(Object.entries(GROUP_KEY).map(([g, key]) => [g, f(key)])) as Record<GroupCode, T>;

/**
 * Пути относительны index.html (работают под любым base GitHub Pages).
 * `pets`: картинки по стадиям; пока одна на группу — рендер масштабирует её от `stage`.
 */
export const ART = {
  room: 'assets/room.svg',
  nest: 'assets/nest.svg',
  pile: 'assets/pile.svg',
  flies: 'assets/flies.svg',
  medkit: 'assets/medkit.svg',
  toy: 'assets/toy.svg',
  grave: 'assets/grave.svg',
  /** три фазы яйца: целое, трещина, большая трещина */
  eggs: byGroup((key) => [0, 1, 2].map((phase) => `assets/eggs/${key}-${phase}.svg`)),
  pets: byGroup((key) => [`assets/pets/${key}.png`]),
};
