import type { GroupCode } from '@/engine/types';

/** Ключ группы в именах файлов (латиницей). */
export const GROUP_KEY: Record<GroupCode, string> = {
  СР1: 'sr1', СР2: 'sr2', СР3: 'sr3', СР5: 'sr5', СР6: 'sr6', СР9: 'sr9',
};

const byGroup = <T>(f: (key: string) => T): Record<GroupCode, T> =>
  Object.fromEntries(Object.entries(GROUP_KEY).map(([g, key]) => [g, f(key)])) as Record<GroupCode, T>;

/**
 * Пути относительны index.html (работают под любым base GitHub Pages).
 * `pets`: картинки по стадиям; пока одна болванка на группу — рендер масштабирует её от `stage`.
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
  pets: byGroup((key) => [`assets/pets/${key}.svg`]),
};

/** Оформление комнаты группы на экране ТВ (макет rooms-and-walk): вид питомца, цвет группы, стена, пол, декор. */
export interface RoomTheme {
  species: string;
  accent: string;
  wall: [string, string];
  floor: string;
  decor: 'savanna' | 'pond' | 'sun' | 'night' | 'library' | 'water';
}

export const THEME: Record<GroupCode, RoomTheme> = {
  СР1: { species: 'Львёнок', accent: '#c0675d', wall: ['#ecd2b4', '#ddb48e'], floor: '#b98c62', decor: 'savanna' },
  СР2: { species: 'Утёнок', accent: '#6f9a6a', wall: ['#d3dfc8', '#b8cbaa'], floor: '#8ea67c', decor: 'pond' },
  СР3: { species: 'Цыплёнок', accent: '#c99c38', wall: ['#f0dfab', '#e2c680'], floor: '#c4a165', decor: 'sun' },
  СР5: { species: 'Ягнёнок', accent: '#555a6c', wall: ['#5d6480', '#474c63'], floor: '#3c4052', decor: 'night' },
  СР6: { species: 'Совёнок', accent: '#8b6fa3', wall: ['#d2c5dd', '#b9a8c8'], floor: '#8d7a6a', decor: 'library' },
  СР9: { species: 'Бегемотик', accent: '#5b86b8', wall: ['#c9dae8', '#adc5db'], floor: '#7f9cb6', decor: 'water' },
};
