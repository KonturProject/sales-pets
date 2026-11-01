import { GROUPS, type GroupCode } from '@/engine/types';
import { ApiError } from '@/data/api';
import type { AdminCtx } from './ctx';
import { errorText, h } from './dom';
import { checkNewPin } from './pinForm';

/**
 * Вкладка «PIN-коды»: выпуск новых PIN групп (показ живёт в `<output>` и стирается кнопкой «Закрыть») и смена
 * админ-PIN. Поля PIN без `name` и очищаются сразу при отправке: PIN не остаётся ни в DOM, ни в хранилище.
 */
export function pinsTab(ctx: AdminCtx): HTMLElement {
  const status = h('p', { role: 'status' });
  const shown = h('output', { 'data-pins': true });
  const actions = h('div', {});

  function showStart(): void {
    actions.replaceChildren(h('button', { type: 'button', onclick: showConfirm }, 'Выпустить PIN групп'));
  }

  function showConfirm(): void {
    actions.replaceChildren(
      h('p', {}, 'Старые PIN всех групп перестанут работать. Выпустить новые?'),
      h('button', { type: 'button', onclick: () => void issue() }, 'Да, выпустить'),
      h('button', { type: 'button', onclick: showStart }, 'Отмена'),
    );
  }

  async function issue(): Promise<void> {
    showStart();
    status.textContent = '';
    try {
      const { groupPins } = await ctx.session.call<{ groupPins: Record<GroupCode, string> }>('setGroupPins');
      let text = GROUPS.map((g) => `${g} — ${groupPins[g]}`).join('\n');
      const rows = GROUPS.map((g) => h('tr', {}, h('th', { scope: 'row' }, g), h('td', {}, groupPins[g])));
      shown.replaceChildren(
        h('table', {}, ...rows),
        h('button', { type: 'button', onclick: () => void navigator.clipboard.writeText(text).catch(() => (status.textContent = 'Не удалось скопировать')) }, 'Копировать'),
        h('button', { type: 'button', onclick: close }, 'Закрыть'),
      );
      function close(): void {
        text = '';
        shown.replaceChildren();
      }
    } catch (e) {
      status.textContent = errorText(e);
    }
  }

  const pinField = (label: string) => h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', 'aria-label': label, 'data-new-pin': true });
  const first = pinField('Новый PIN');
  const second = pinField('Новый PIN ещё раз');
  const pinStatus = h('p', { role: 'status', 'data-status': 'admin-pin' });
  const pinAlert = h('p', { role: 'alert', 'data-alert': 'admin-pin' });

  async function changePin(): Promise<void> {
    const a = first.value;
    const b = second.value;
    first.value = '';
    second.value = '';
    pinStatus.textContent = '';
    pinAlert.textContent = '';
    const error = checkNewPin(a, b);
    if (error) {
      pinAlert.textContent = error;
      return;
    }
    try {
      await ctx.session.call('changePin', { newPin: a });
    } catch (e) {
      pinAlert.textContent = e instanceof ApiError && e.code === 'bad_request'
        ? 'Сервер не принял PIN: он совпадает с PIN одной из групп'
        : errorText(e);
      return;
    }
    try {
      await ctx.session.login(a);
      pinStatus.textContent = 'Админ-PIN изменён. Старый больше не работает.';
    } catch (e) {
      pinAlert.textContent = `Админ-PIN изменён, но войти им не удалось (${errorText(e)}): выйдите и войдите новым PIN.`;
    }
  }

  const change = h(
    'form',
    { 'data-form': 'admin-pin', onsubmit: (e) => { e.preventDefault(); void changePin(); } },
    h('label', {}, 'Новый PIN ', first),
    h('label', {}, 'Ещё раз ', second),
    h('button', { type: 'submit' }, 'Сменить админ-PIN'),
    pinStatus,
    pinAlert,
  );

  showStart();
  return h(
    'div',
    {},
    h('section', {}, h('h2', {}, 'PIN групп'), h('p', {}, 'PIN нужен РГ для входа на свою страницу. Покажется один раз: сохраните его до закрытия.'), actions, shown, status),
    h('section', {}, h('h2', {}, 'Админ-PIN'), h('p', {}, '4–12 цифр. Другим не сообщайте и нигде не записывайте.'), change),
  );
}
