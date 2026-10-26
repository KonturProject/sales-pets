import './admin.css';
import { api } from '@/data/api';
import { h, tabs, errorText } from './dom';
import type { AdminCtx } from './ctx';
import { paymentsTab } from './payments';
import { pinsTab } from './pins';
import { createSession } from './session';

const root = document.getElementById('app')!;

const session = createSession(api.post, () => showLogin('Сессия закончилась: войдите снова'));
const ctx: AdminCtx = {
  session,
  snapshot: async () => {
    const s = await api.get();
    if (s === 'unchanged') throw new Error('unexpected unchanged');
    return s;
  },
};

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
    tabs([
      { id: 'payments', title: 'Оплаты', render: () => paymentsTab(ctx) },
      { id: 'pins', title: 'PIN-коды', render: () => pinsTab(ctx) },
    ]),
  );
}

showLogin();
