import type { Snapshot } from '@/data/api';
import type { DateStr, GroupCode } from '@/engine/types';
import type { AdminCtx } from './ctx';
import { errorText, h } from './dom';
import { correctionItems, correctionViews, dayResults, defaultResultsDay, resultsDays, type EmployeeLine, type Kind } from './results';
import { INTERRUPTED_TEXT, STALE_TEXT, WriteRefused, type FlowView } from './resultsFlow';
import { KIND_WORD, dayLabel, shortDate, signed, staleText } from './resultsText';
import { renderResults } from './resultsView';

/**
 * Вкладка «Итоги»: выбор дня, таблица групп с раскрытием в сотрудников, правка факта у сотрудника и список всех правок
 * с «Отменить». Опроса у админки нет: после каждой записи снимок читается заново и всё перерисовывается, а раскрытые
 * группы и выбранный день остаются. Пока идёт запись (правка или отмена), вся вкладка недоступна (`inert`), а вкладки
 * админки и «Выйти» отключены: ни второй редактор, ни раскрытие, ни смена дня, ни «Отменить» не мешают записи и не
 * теряют введённое. Если после записи свежие данные прочитать не удалось, таблица и список закрыты, пока «Обновить» не
 * получит их: правка, посчитанная от устаревшей таблицы, задвоила бы или исказила запись.
 *
 * Вкладка только рисует: состояние записи (занято, устарело, неотвеченный запрос, идущая проверка) лежит в общем
 * потоке `ctx.resultsFlow`, один на всю страницу. При открытии вкладка сначала просит у потока проверить потерянную
 * запись (одна проверка на все открытия, второго повтора нет) и лишь после неё читает первый снимок: снимок до проверки
 * не показывался бы как свежий. Вид подключается только у самого нового открытия.
 */
export async function resultsTab(ctx: AdminCtx): Promise<HTMLElement> {
  const flow = ctx.resultsFlow;
  const opening = flow.begin();
  const checked = await opening.open();
  let snapshot: Snapshot = await ctx.snapshot();
  const first = defaultResultsDay(snapshot);
  if (first === null) return h('div', {}, h('p', {}, 'Игра ещё не началась — итогов пока нет'));
  let date: DateStr = first;

  const open = new Set<GroupCode>();
  const root = h('div', { class: 'results-tab' });
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
  const refreshButton = h('button', { type: 'button', 'data-refresh': true, onclick: () => void reload() }, 'Обновить');
  const staleLabel = h('span', {}, STALE_TEXT);
  const staleBox = h('p', { role: 'alert', class: 'results-stale', 'data-stale': true, hidden: true }, staleLabel, ' ', refreshButton);
  /** Что поток делает с этой вкладкой: свежие данные, «занято» (вся вкладка inert), «устарело» (таблица и список закрыты). */
  const view: FlowView<Snapshot> = {
    apply: (fresh) => {
      snapshot = fresh;
      paint();
    },
    setBusy: (busy) => {
      root.inert = busy;
    },
    setStale: (stale) => {
      staleBox.hidden = !stale;
      staleLabel.textContent = flow.staleText; // «загрузка без ответа»: «Обновить» не поможет, есть другой текст и нет кнопки
      refreshButton.hidden = flow.unresolved !== null;
      tableBox.inert = stale;
      listBox.inert = stale;
    },
  };

  /** «Сохранить» в редакторе. Ошибка запроса уходит редактору (он её показывает), итог записи — вкладке. */
  async function correct(line: EmployeeLine, wanted: Record<Kind, number>): Promise<void> {
    alert.textContent = '';
    status.textContent = '';
    const items = correctionItems(line, wanted, date);
    if ('error' in items || items.length === 0) return; // редактор уже сказал об этом сам
    const done = await flow.correct(items);
    if (done.refreshError) {
      alert.textContent = done.result === 'saved'
        ? `Правка сохранена, но обновить таблицу не удалось: ${errorText(done.refreshError)}.`
        : `Связь прерывалась: прошлая правка проверена, но данные перечитать не удалось: ${errorText(done.refreshError)}.`;
    } else if (done.result === 'changed') alert.textContent = INTERRUPTED_TEXT;
    else status.textContent = 'Правка сохранена';
  }

  async function remove(id: number): Promise<void> {
    alert.textContent = '';
    status.textContent = '';
    try {
      const done = await flow.remove(id);
      if (done.refreshError) {
        alert.textContent = done.removed
          ? `Правка отменена, но обновить таблицу не удалось: ${errorText(done.refreshError)}.`
          : `Связь прерывалась: прошлая правка проверена, но данные перечитать не удалось: ${errorText(done.refreshError)}.`;
      } else if (!done.removed) alert.textContent = INTERRUPTED_TEXT; // правка не отменена: нажмите «Отменить» ещё раз на свежих данных
      else status.textContent = 'Правка отменена';
    } catch (e) {
      alert.textContent = e instanceof WriteRefused ? e.message : errorText(e);
    }
  }

  /** «Обновить» и открытие вкладки: проверить потерянную запись повтором, прочитать данные. Не вышло — вкладка закрыта. */
  async function reload(): Promise<void> {
    alert.textContent = '';
    status.textContent = '';
    try {
      const done = await flow.reload();
      if (done.error) {
        alert.textContent = `Обновить не удалось: ${errorText(done.error)}`;
        refreshButton.focus(); // вкладка на время чтения была inert: фокус с кнопки ушёл
      } else if (done.checked) alert.textContent = INTERRUPTED_TEXT;
      else status.textContent = 'Данные обновлены';
    } catch (e) {
      alert.textContent = e instanceof WriteRefused ? e.message : errorText(e);
    }
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
  root.append(
    h(
      'section',
      {},
      h('h2', {}, 'Итоги по группам'),
      h('label', {}, 'День ', day),
      h('p', { class: 'muted' }, 'Факт / план за выбранный день и с начала игры: ✓ — план выполнен, ✗ — нет. «Итог дня» — что даст оценка этого дня на следующий рабочий день. Нажмите на группу, чтобы увидеть сотрудников.'),
      alert,
      staleBox,
      status,
      tableBox,
    ),
    listBox,
  );
  if (!opening.attach(view)) return h('div'); // открытие успели сменить более новым: этот экземпляр на экран не попадёт
  // вид получил «устарело» и «занято» от потока уже при подключении, то есть с первого кадра
  if (checked?.error) alert.textContent = `Обновить не удалось: ${errorText(checked.error)}`;
  else if (checked?.checked) alert.textContent = INTERRUPTED_TEXT;
  return root;
}
