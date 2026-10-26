import '@/game/room.css';
import './rg.css';
import { ApiError, api, resolvePollMs, serverToday } from '@/data/api';
import { buildFacts } from '@/data/facts';
import { createStore } from '@/data/store';
import { GROUPS, type GroupCode } from '@/engine/types';
import { MAX_STAGE, PetView } from '@/game/PetView';
import { errorText, h } from '@/admin/dom';
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

/** PIN группы живёт только в замыканиях `spender` и этой функции: ни в DOM, ни в хранилище, ни в консоли. */
function showWork(group: GroupCode, groupPin: string): void {
  const spender = createSpender({ send: (item, ref) => api.post('useItem', { group, groupPin, item, ref }) });
  const view = new PetView(group);
  const stageText = h('p', { 'data-stage-text': true });
  const alert = h('p', { role: 'alert' });
  const medkit = h('button', { type: 'button', 'data-use': 'medkit', title: 'Лечит болезнь', onclick: () => void use('medkit') }, 'Аптечка');
  const toy = h('button', { type: 'button', 'data-use': 'toy', title: 'Лечит скуку и грусть', onclick: () => void use('toy') }, 'Игрушка');
  const loading = h('p', {}, 'Загрузка…');
  const main = h('main', { hidden: true }, view.el, stageText, h('div', { class: 'actions' }, medkit, toy), alert);
  let locked = false;

  // Состояние считается на «сегодня» сервера (R23), как и в админке.
  function paint(): void {
    const snapshot = store.current();
    if (!snapshot) return;
    const s = buildFacts(snapshot, serverToday(snapshot)).states[group];
    view.update(s);
    stageText.textContent = !s.alive ? 'Питомец погиб' : s.phase === 'pet' ? `стадия ${s.stage} из ${MAX_STAGE}` : 'яйцо';
    medkit.disabled = locked || !s.alive || s.medkits === 0;
    toy.disabled = locked || !s.alive || s.toys === 0;
    loading.hidden = true;
    main.hidden = false;
  }

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
