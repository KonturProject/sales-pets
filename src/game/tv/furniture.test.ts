import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { RoomTheme } from '@/art/manifest';
import { CATALOG, PLACES, type ItemId, type Place } from '@/engine/shop';
import { DESK_TOP, IMAGE_SIZE, SCREEN, UI_BOXES, furnitureLayout, spotX, type Box } from './furniture';

const THEMES: RoomTheme['decor'][] = ['savanna', 'pond', 'sun', 'night', 'library', 'water'];
const ROOM = { w: 529, h: 446 };
const byPlace = (place: Place) => CATALOG.filter((i) => i.place === place).map((i) => i.id);
/** Наборы «по вещи на каждое место»: k-й набор берёт k-ю вещь места (по кругу), четыре набора покрывают все 25. */
const SETS: Partial<Record<Place, ItemId>>[] = [0, 1, 2, 3].map((k) =>
  Object.fromEntries(PLACES.map((p) => [p, byPlace(p)[k % byPlace(p).length]!])));
const cross = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('мебель в комнате', () => {
  test('наборы покрывают все 25 вещей', () => {
    expect(new Set(SETS.flatMap((s) => Object.values(s))).size).toBe(25);
  });

  test('в каждой теме вещи внутри комнаты и не заходят на табличку, табло, ящики и кучки', () => {
    for (const decor of THEMES) for (const owned of SETS) {
      const items = furnitureLayout(owned, decor);
      expect(items).toHaveLength(PLACES.length);
      for (const { id, box } of items) {
        expect(box.x >= 0 && box.y >= 0 && box.x + box.w <= ROOM.w && box.y + box.h <= ROOM.h, `${decor} ${id} вне комнаты`).toBe(true);
        for (const [ui, b] of Object.entries(UI_BOXES)) expect(cross(box, b), `${decor} ${id} заходит на ${ui}`).toBe(false);
      }
    }
  });

  test('компьютер и телефон стоят на столешнице своего стола, в его ширине, и не задевают друг друга', () => {
    for (const owned of SETS) {
      const items = furnitureLayout(owned, 'sun');
      const at = (p: Place) => items.find((i) => i.place === p)!;
      const desk = at('desk'), top = desk.box.y + Math.round(DESK_TOP[desk.id as 'desk-office'] * desk.box.h);
      for (const p of ['pc', 'phone'] as const) {
        const { box } = at(p);
        expect(box.y + box.h, `${at(p).id} на ${desk.id}`).toBe(top);
        expect(box.x >= desk.box.x && box.x + box.w <= desk.box.x + desk.box.w, `${at(p).id} шире стола`).toBe(true);
      }
      expect(cross(at('pc').box, at('phone').box)).toBe(false);
    }
  });

  test('без стола компьютер и телефон не ставятся', () => {
    const items = furnitureLayout({ pc: 'pc-dual', phone: 'phone-office', rug: 'rug-paw' }, 'pond');
    expect(items.map((i) => i.place)).toEqual(['rug']);
  });

  test('коврик лежит ниже всех вещей', () => {
    const items = furnitureLayout(SETS[0]!, 'night');
    const rug = items.find((i) => i.place === 'rug')!;
    for (const i of items) if (i !== rug) expect(i.z).toBeGreaterThan(rug.z);
  });

  test('место питомца у телефона, компьютера и в углу — в пределах прогулки, без вещи — null', () => {
    for (const owned of SETS) for (const p of ['phone', 'pc', 'corner'] as const) {
      const x = spotX(p, owned)!;
      expect(x >= 70 && x <= 459, `${p} ${owned[p]} x=${x}`).toBe(true);
    }
    expect(spotX('phone', {})).toBeNull();
    expect(spotX('pc', { pc: 'pc-crt' })).toBeNull();
    expect(spotX('corner', { desk: 'desk-wood' })).toBeNull();
  });

  test('пропорции вещей — как у нарезанных картинок', () => {
    for (const { id } of CATALOG) {
      const png = readFileSync(`public/assets/furniture/${id}.png`);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], id).toEqual([...IMAGE_SIZE[id]]);
    }
  });

  test('экраны компьютеров — внутри картинки', () => {
    for (const boxes of Object.values(SCREEN)) for (const s of boxes) {
      expect(s.x >= 0 && s.y >= 0 && s.x + s.w <= 1 && s.y + s.h <= 1).toBe(true);
    }
    expect(SCREEN['pc-dual']).toHaveLength(2);
  });
});
