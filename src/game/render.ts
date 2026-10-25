import { ART } from '@/art/manifest';
import type { PetState } from '@/engine/pet';
import { GROUPS, type GroupCode } from '@/engine/types';
import { PetView } from './PetView';

/** Рисует комнату с шестью гнёздами; `update()` перечитывает состояния и обновляет DOM точечно. */
export function mount(root: HTMLElement, getStates: () => Record<GroupCode, PetState>): { update(): void } {
  const views = GROUPS.map((g) => new PetView(g));
  views.forEach((v, i) => v.el.style.setProperty('--delay', `${-i * 1.7}s`));

  const spots = document.createElement('div');
  spots.className = 'spots';
  spots.append(...views.map((v) => v.el));

  const room = document.createElement('main');
  room.className = 'room';
  room.style.backgroundImage = `url(${ART.room})`;
  room.append(spots);
  root.replaceChildren(room);

  const update = () => {
    const states = getStates();
    views.forEach((v) => v.update(states[v.group]));
  };
  update();
  return { update };
}
