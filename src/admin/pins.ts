import { GROUPS, type GroupCode } from '@/engine/types';
import type { AdminCtx } from './ctx';
import { errorText, h } from './dom';

/** Вкладка «PIN-коды»: выпуск новых PIN групп. Показ живёт в `<output>` и стирается кнопкой «Закрыть». */
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

  showStart();
  return h('section', {}, h('p', {}, 'PIN нужен РГ для входа на свою страницу. Покажется один раз: сохраните его до закрытия.'), actions, shown, status);
}
