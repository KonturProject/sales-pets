import type { PetState } from '@/engine/pet';
import type { ShopState } from '@/engine/shop';

/** Комната — пляж, питомец — пляжная картинка: группа в отпуске, питомец жив и вылупился (погибший — в обычной комнате). */
export function showBeach(s: PetState, shop: ShopState | null): boolean {
  return !!shop?.vacation && s.alive && s.phase === 'pet';
}
