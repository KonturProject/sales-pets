import '@/game/room.css';
import './rg.css';
import { ART } from '@/art/manifest';
import { ApiError, api, resolvePollMs, serverToday } from '@/data/api';
import { buildFacts } from '@/data/facts';
import { createStore } from '@/data/store';
import { GROUPS, type GroupCode } from '@/engine/types';
import { MAX_STAGE, PetView } from '@/game/PetView';
import { errorText, h } from '@/admin/dom';
import { dragStep, type DragEvent, type DragResult, type DragState, type Point, type Rect } from './drag';
import { createSpender, type Item } from './spend';

/** Кнопки заблокированы ещё на это время после расхода: быстрый ответ не должен пропускать второй клик двойного нажатия. */
const COOLDOWN_MS = 600;

const root = document.getElementById('app')!;

const store = createStore({
  fetchSnapshot: (since) => api.get(since),
  pollMs: resolvePollMs(location.search, { dev: import.meta.env.DEV, hostname: location.hostname }),
});

function showLogin(message = ''): void {
  const group = h('select', { 'data-field': 'group', 'aria-label': 'Группа' }, ...GROUPS.map((g) => h('option', { value: g }, g)));
  // Поле PIN без `name`: браузер не предлагает сохранить его и не автозаполняет.
  const input = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', required: true, 'aria-label': 'PIN' });
  const alert = h('p', { role: 'alert' }, message);
  const form = h(
    'form',
    {
      'data-login': true,
      onsubmit: (e) => {
        e.preventDefault();
        const groupPin = input.value;
        input.value = '';
        alert.textContent = '';
        const code = group.value as GroupCode;
        api.post('groupLogin', { group: code, groupPin }).then(() => showWork(code, groupPin), (err) => {
          alert.textContent = errorText(err);
        });
      },
    },
    h('h1', {}, 'Питомец группы'),
    h('label', {}, 'Группа ', group),
    h('label', {}, 'PIN ', input),
    h('button', { type: 'submit' }, 'Войти'),
    alert,
  );
  root.replaceChildren(form);
  input.focus();
}

/** Предмет рядом с питомцем: настоящая кнопка (клавиатура и скринридер), остаток — бейдж. */
function itemButton(item: Item, name: string, title: string, art: string): { button: HTMLButtonElement; stock: HTMLElement } {
  const stock = h('b', { 'data-stock': item }, '0');
  const button = h(
    'button',
    { type: 'button', class: 'item', 'data-use': item, title },
    h('img', { class: 'item-pic', src: art, alt: '', draggable: 'false' }),
    h('span', {}, name),
    stock,
  );
  return { button, stock };
}

const centerOf = (r: Rect): Point => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
const rectOf = (e: Element): Rect => {
  const r = e.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};
const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** PIN группы живёт только в замыканиях `spender` и этой функции: ни в DOM, ни в хранилище, ни в консоли. */
function showWork(group: GroupCode, groupPin: string): void {
  const spender = createSpender({ send: (item, ref) => api.post('useItem', { group, groupPin, item, ref }) });
  const view = new PetView(group);
  const stage = view.el.querySelector<HTMLElement>('.stage')!;
  const stageText = h('p', { 'data-stage-text': true });
  const alert = h('p', { role: 'alert' });
  const hint = h('p', { 'data-hint': true }, 'Перетащите предмет на питомца');
  const medkit = itemButton('medkit', 'Аптечка', 'Лечит болезнь', ART.medkit);
  const toy = itemButton('toy', 'Игрушка', 'Лечит скуку и грусть', ART.toy);
  const items: Record<Item, { button: HTMLButtonElement; stock: HTMLElement }> = { medkit, toy };
  const loading = h('p', {}, 'Загрузка…');
  const main = h('main', { hidden: true }, h('div', { class: 'arena' }, medkit.button, view.el, toy.button), hint, stageText, alert);
  let locked = false;

  // Состояние считается на «сегодня» сервера (R23), как и в админке.
  function paint(): void {
    const snapshot = store.current();
    if (!snapshot) return;
    const s = buildFacts(snapshot, serverToday(snapshot)).states[group];
    view.update(s);
    stageText.textContent = !s.alive ? 'Питомец погиб' : s.phase === 'pet' ? `стадия ${s.stage} из ${MAX_STAGE}` : 'яйцо';
    medkit.stock.textContent = String(s.medkits);
    toy.stock.textContent = String(s.toys);
    medkit.button.disabled = locked || !s.alive || s.medkits === 0;
    toy.button.disabled = locked || !s.alive || s.toys === 0;
    loading.hidden = true;
    main.hidden = false;
    // предмет, который несут, мог кончиться или питомец погибнуть (опрос): перенос отменяется
    if (drag.phase === 'dragging' && items[drag.item].button.disabled) settle();
  }

  // Перенос предмета к питомцу (Pointer Events: мышь, палец, перо одним кодом). Решает автомат `dragStep`, здесь только DOM.
  let drag: DragState = { phase: 'idle' };
  let ghost: HTMLElement | undefined;
  let swallowClick = false;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  function step(event: DragEvent): DragResult {
    const result = dragStep(drag, event);
    drag = result.state;
    stage.classList.toggle('drop-ready', drag.phase === 'dragging' && drag.over);
    if (result.dragged) {
      // следом за настоящим переносом браузер шлёт `click` на предмет: он не должен мигать подсказкой
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
    }
    return result;
  }

  function carry(item: Item, point: Point): void {
    if (!ghost) {
      ghost = h('div', { class: 'drag-ghost' }, h('img', { src: item === 'medkit' ? ART.medkit : ART.toy, alt: '', draggable: 'false' }));
      main.append(ghost);
      items[item].button.toggleAttribute('data-dragging', true);
    }
    ghost.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
  }

  /** Призрак уходит: в питомца (расход) или обратно на место предмета. */
  function leave(item: Item, intoPet: boolean): void {
    items[item].button.toggleAttribute('data-dragging', false);
    const g = ghost;
    ghost = undefined;
    if (!g) return;
    if (reducedMotion()) {
      g.remove();
      return;
    }
    const to = centerOf(rectOf(intoPet ? stage : items[item].button));
    const ms = intoPet ? 150 : 180;
    g.style.transition = `transform ${ms}ms ease-out, opacity ${ms}ms ease-out`;
    g.style.transform = `translate(${to.x}px, ${to.y}px) translate(-50%, -50%)${intoPet ? ' scale(0.3)' : ''}`;
    if (intoPet) g.style.opacity = '0';
    setTimeout(() => g.remove(), ms + 40);
  }

  /** Отмена переноса (потеря указателя, окно потеряло фокус, предмет заблокирован): призрак возвращается, расхода нет. */
  function settle(): void {
    if (drag.phase !== 'dragging') return;
    const item = drag.item;
    step({ type: 'cancel', pointerId: drag.pointerId });
    leave(item, false);
  }

  function flashHint(): void {
    hint.classList.add('flash');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('flash'), 900);
  }

  function bind(item: Item): void {
    const button = items[item].button;
    const at = (e: PointerEvent): Point => ({ x: e.clientX, y: e.clientY });
    button.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      step({ type: 'down', item, pointerId: e.pointerId, point: at(e), canStart: !button.disabled });
      if (drag.phase === 'dragging' && drag.pointerId === e.pointerId) button.setPointerCapture(e.pointerId);
    });
    button.addEventListener('pointermove', (e) => {
      step({ type: 'move', pointerId: e.pointerId, point: at(e), zone: rectOf(stage) });
      if (drag.phase === 'dragging' && drag.armed && drag.pointerId === e.pointerId) carry(item, at(e));
    });
    button.addEventListener('pointerup', (e) => {
      const result = step({ type: 'up', pointerId: e.pointerId, point: at(e), zone: rectOf(stage) });
      const drop = result.drop && !button.disabled ? result.drop : undefined;
      leave(item, drop !== undefined);
      if (drop) void use(drop);
    });
    for (const type of ['pointercancel', 'lostpointercapture'] as const) {
      button.addEventListener(type, (e) => {
        // после обычного `pointerup` автомат уже в покое и это событие ничего не меняет
        if (drag.phase === 'dragging' && drag.pointerId === e.pointerId) settle();
      });
    }
    button.addEventListener('click', (e) => {
      if (swallowClick) return;
      if (e.detail === 0) void use(item); // Enter, Space, скринридер: перетаскивать нечем
      else flashHint();
    });
  }
  bind('medkit');
  bind('toy');
  const onBlur = () => settle();
  window.addEventListener('blur', onBlur);

  async function use(item: Item): Promise<void> {
    if (locked) return;
    locked = true;
    alert.textContent = '';
    paint();
    try {
      await spender.spend(item);
      await store.refresh();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'invalid_pin' || e.code === 'locked')) {
        logout(errorText(e));
        return;
      }
      alert.textContent = e instanceof ApiError && e.code === 'bad_request' ? 'Сервер не принял расход: возможно, достигнут дневной предел' : errorText(e);
    }
    setTimeout(() => {
      locked = false;
      paint();
    }, COOLDOWN_MS);
  }

  const off = store.subscribe(paint);
  function logout(message = ''): void {
    window.removeEventListener('blur', onBlur);
    settle();
    ghost?.remove();
    off();
    store.stop();
    showLogin(message);
  }

  root.replaceChildren(
    h('header', { class: 'bar' }, h('h1', {}, `Питомец ${group}`), h('button', { type: 'button', 'data-logout': true, onclick: () => logout() }, 'Выйти')),
    loading,
    main,
  );
  store.start();
  paint();
}

showLogin();
