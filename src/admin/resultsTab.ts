import type { Snapshot } from '@/data/api';
import type { DateStr, GroupCode } from '@/engine/types';
import { createCorrectionSaver } from './correctionSaver';
import type { AdminCtx } from './ctx';
import { errorText, h } from './dom';
import { correctionItems, correctionViews, dayResults, defaultResultsDay, resultsDays, type EmployeeLine, type Kind } from './results';
import { KIND_WORD, dayLabel, shortDate, signed, staleText } from './resultsText';
import { renderResults } from './resultsView';

/**
 * Вкладка «Итоги»: выбор дня, таблица групп с раскрытием в сотрудников, правка факта у сотрудника и список всех правок
 * с «Отменить». Опроса у админки нет: после каждой записи снимок читается заново и всё перерисовывается, а раскрытые
 * группы и выбранный день остаются.
 */
export async function resultsTab(ctx: AdminCtx): Promise<HTMLElement> {
  let snapshot: Snapshot = await ctx.snapshot();
  const first = defaultResultsDay(snapshot);
  if (first === null) return h('div', {}, h('p', {}, 'Игра ещё не началась — итогов пока нет'));
  let date: DateStr = first;

  const open = new Set<GroupCode>();
  const alert = h('p', { role: 'alert', 'data-alert': 'results' });
  const status = h('p', { role: 'status', 'data-status': 'results' });
  const day = h('select', {
    'data-field': 'results-day',
    onchange: () => {
      date = day.value;
      paint();
    },
  });
  const tableBox = h('div', {});
  const listBox = h('section', { 'data-corrections': true });
  const saver = createCorrectionSaver({ send: (items, ref) => ctx.session.call('addCorrections', { items, ref }) });
  let removing = false;

  /** Свежий снимок и перерисовка. Запись к этому моменту уже на сервере, поэтому сбой чтения — отдельное сообщение. */
  async function reload(done: string): Promise<void> {
    try {
      snapshot = await ctx.snapshot();
    } catch (e) {
      alert.textContent = `${done}, но обновить таблицу не удалось: ${errorText(e)}. Откройте вкладку заново.`;
      return;
    }
    status.textContent = done;
    paint();
  }

  async function correct(line: EmployeeLine, wanted: Record<Kind, number>): Promise<void> {
    alert.textContent = '';
    status.textContent = '';
    const items = correctionItems(line, wanted, date);
    if ('error' in items || items.length === 0) return; // редактор уже сказал об этом сам
    if (await saver.save(items)) await reload('Правка сохранена');
  }

  async function remove(id: number): Promise<void> {
    if (removing || saver.busy) return;
    removing = true;
    alert.textContent = '';
    status.textContent = '';
    listBox.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await ctx.session.call('removeCorrection', { id });
      await reload('Правка отменена');
    } catch (e) {
      alert.textContent = errorText(e);
    }
    removing = false;
    paintList();
  }

  function paintList(): void {
    const views = correctionViews(snapshot);
    listBox.replaceChildren(
      h('h2', {}, 'Ручные правки фактов'),
      h('p', { class: 'muted' }, 'Новые сверху. «Отменить» убирает правку, как будто её не было.'),
      views.length === 0
        ? h('p', {}, 'Правок пока нет')
        : h(
          'table',
          { 'data-table': 'corrections' },
          h('thead', {}, h('tr', {}, ...['Дата', 'Группа', 'Сотрудник', 'Показатель', 'Изменение', 'Примечание', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...views.map((v) => h(
            'tr',
            { 'data-correction': v.c.id },
            h('td', {}, shortDate(v.c.date)),
            h('td', {}, v.group ?? '—'),
            h('td', {}, v.name),
            h('td', {}, KIND_WORD[v.c.kind]),
            h('td', {}, signed(v.c.delta)),
            h('td', { class: 'stale' }, v.stale ? `⚠ ${staleText(v)}` : ''),
            h('td', {}, h('button', { type: 'button', class: 'small', 'data-remove-correction': v.c.id, onclick: () => void remove(v.c.id) }, 'Отменить')),
          ))),
        ),
    );
  }

  function paint(): void {
    day.replaceChildren(...resultsDays(snapshot).map((d) => h('option', { value: d.date, selected: d.date === date }, dayLabel(d))));
    tableBox.replaceChildren(renderResults(dayResults(snapshot, date), { date, open, onCorrect: correct }));
    paintList();
  }

  paint();
  return h(
    'div',
    {},
    h(
      'section',
      {},
      h('h2', {}, 'Итоги по группам'),
      h('label', {}, 'День ', day),
      h('p', { class: 'muted' }, 'Факт / план за выбранный день и с начала игры: ✓ — план выполнен, ✗ — нет. «Итог дня» — что даст оценка этого дня на следующий рабочий день. Нажмите на группу, чтобы увидеть сотрудников.'),
      alert,
      status,
      tableBox,
    ),
    listBox,
  );
}
