import './admin.css';
import { api } from '@/data/api';
import { h, tabs, errorText, newVersionSlot } from './dom';
import type { PendingHolder } from './correctionSaver';
import type { AdminCtx } from './ctx';
import { importTab } from './importTab';
import { createNavLock } from './navLock';
import { normsTab } from './normsTab';
import { overridesTab } from './overridesTab';
import { paymentsTab } from './payments';
import { pinsTab } from './pins';
import { resultsTab } from './resultsTab';
import { createSession, type Session } from './session';
import { staffTab } from './staffTab';
import { todayLine, todayTasks } from './today';

const root = document.getElementById('app')!;

const session = createSession(api.post, (e) => showLogin(e.code === 'locked' ? errorText(e) : 'Сессия закончилась: войдите снова'));
/** Блок «Сегодня» над вкладками: день игры и что сделать; обновляется с каждым снимком, который читает админка, и после каждой записи. */
const todayText = h('p', { 'data-today-line': true });
const todayList = h('ul', { 'data-today-tasks': true });
const todayBox = h('section', { class: 'today' }, todayText, todayList);
const snapshot: AdminCtx['snapshot'] = async () => {
  const s = await api.get();
  if ('unchanged' in s) throw new Error('unexpected unchanged');
  todayText.textContent = todayLine(s);
  todayList.replaceChildren(...todayTasks(s).map((t) => h('li', { class: t.done ? 'done' : 'todo' }, t.text)));
  return s;
};
const tracked: Session = {
  ...session,
  async call<T>(action: string, body?: object): Promise<T> {
    const result = await session.call<T>(action, body);
    if (action !== 'getPrivate') snapshot().catch(() => {});
    return result;
  },
};
/** Смена вкладки или выход посреди записи убрали бы вкладку из-под неё, а новая прочла бы данные раньше записи. */
const lockNav: AdminCtx['lockNav'] = createNavLock((locked) => {
  for (const b of root.querySelectorAll<HTMLButtonElement>('header button, [role="tablist"] button')) b.disabled = locked;
});
/** Правка «Итогов», на которую не пришёл ответ: переживает смену вкладки админки (см. `PendingHolder`). */
const pendingCorrection: PendingHolder = { current: null };
const ctx: AdminCtx = { session: tracked, snapshot, lockNav, pendingCorrection };

const updateSlot = newVersionSlot();

function showLogin(message = ''): void {
  // Поле PIN без `name`: браузер не предлагает сохранить его и не автозаполняет.
  const input = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', required: true, 'aria-label': 'PIN' });
  const alert = h('p', { role: 'alert' }, message);
  const form = h(
    'form',
    {
      'data-login': true,
      onsubmit: (e) => {
        e.preventDefault();
        const pin = input.value;
        input.value = '';
        alert.textContent = '';
        session.login(pin).then(showWork, (err) => {
          alert.textContent = errorText(err);
        });
      },
    },
    h('h1', {}, 'Админка'),
    h('label', {}, 'PIN ', input),
    h('button', { type: 'submit' }, 'Войти'),
    alert,
  );
  root.replaceChildren(form);
  input.focus();
}

function showWork(): void {
  const logout = h('button', { type: 'button', onclick: () => { session.logout(); showLogin(); } }, 'Выйти');
  root.replaceChildren(
    h('header', {}, h('h1', {}, 'Админка'), logout),
    updateSlot,
    todayBox,
    tabs([
      { id: 'results', title: 'Итоги', render: () => resultsTab(ctx) },
      { id: 'payments', title: 'Оплаты', render: () => paymentsTab(ctx) },
      { id: 'import', title: 'Импорт', render: () => importTab(ctx) },
      { id: 'staff', title: 'Сотрудники', render: () => staffTab(ctx) },
      { id: 'norms', title: 'Нормы и пороги', render: () => normsTab(ctx) },
      { id: 'overrides', title: 'Ручные правки', render: () => overridesTab(ctx) },
      { id: 'pins', title: 'PIN-коды', render: () => pinsTab(ctx) },
    ]),
  );
}

showLogin();
