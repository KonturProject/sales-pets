import type { Item } from './spend';

export interface Point { x: number; y: number }
export interface Rect { left: number; top: number; right: number; bottom: number }

/** На сколько пикселей нужно сдвинуться от места нажатия, чтобы это считалось переносом, а не кликом. */
export const MIN_DRAG = 8;

export type DragState =
  | { phase: 'idle' }
  | { phase: 'dragging'; item: Item; pointerId: number; origin: Point; armed: boolean; over: boolean };

export type DragEvent =
  | { type: 'down'; item: Item; pointerId: number; point: Point; canStart: boolean }
  | { type: 'move'; pointerId: number; point: Point; zone: Rect }
  | { type: 'up'; pointerId: number; point: Point; zone: Rect }
  | { type: 'cancel'; pointerId: number };

export interface DragResult {
  state: DragState;
  /** предмет, который нужно потратить: отпущен над зоной после настоящего переноса */
  drop?: Item;
  /** был настоящий перенос (а не клик): следующий `click` нужно погасить */
  dragged?: boolean;
}

const IDLE: DragState = { phase: 'idle' };

/** Границы включены; `slack` расширяет зону со всех сторон (на странице РГ он 0). */
export function inZone(point: Point, rect: Rect, slack = 0): boolean {
  return point.x >= rect.left - slack && point.x <= rect.right + slack && point.y >= rect.top - slack && point.y <= rect.bottom + slack;
}

/**
 * Автомат переноса предмета к питомцу, без DOM. Перенос «взводится» (`armed`), когда указатель ушёл на `MIN_DRAG` от места
 * нажатия, и остаётся взведённым; над зоной (`over`) и с расходом при отпускании можно быть только взведённым — обычный
 * клик по предмету потратить его не может. События других указателей (второй палец) игнорируются.
 */
export function dragStep(state: DragState, event: DragEvent): DragResult {
  if (event.type === 'down') {
    if (state.phase === 'dragging' || !event.canStart) return { state };
    return { state: { phase: 'dragging', item: event.item, pointerId: event.pointerId, origin: event.point, armed: false, over: false } };
  }
  if (state.phase === 'idle' || event.pointerId !== state.pointerId) return { state };
  if (event.type === 'cancel') return { state: IDLE, dragged: state.armed };

  const armed = state.armed || Math.hypot(event.point.x - state.origin.x, event.point.y - state.origin.y) >= MIN_DRAG;
  const over = armed && inZone(event.point, event.zone);
  if (event.type === 'move') return { state: { ...state, armed, over } };
  return { state: IDLE, drop: over ? state.item : undefined, dragged: armed };
}
