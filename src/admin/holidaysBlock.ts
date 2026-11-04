import { serverToday, type Snapshot } from '@/data/api';
import { configOf } from '@/data/config';
import type { DateStr } from '@/engine/types';
import { calendarChanges, calendarPreview, calendarWeeks, toggleDay } from './calendarForm';
import { describeChange } from './configPreview';
import type { AdminCtx } from './ctx';
import { dayChangeText } from './effects';
import { errorText, h, ruDate } from './dom';
import { INTERRUPTED_TEXT, WriteRefused, type FlowView, type ReloadDone } from './resultsFlow';
import { shortDate } from './resultsText';

/** Что админ должен знать о выходных (раздел 5 спеки): показывается под сеткой всегда. */
const NOTES = [
  'Выходной не оценивается.',
  'Оплаты выходного идут в следующий рабочий день.',
  'Дни без оплат его пропускают.',
  'План оплат на игру считается без него.',
  'Сегодняшний день тоже можно сделать выходным.',
];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
/** Ключ записи в общем потоке, он же метка `data-*` блока. */
const KEY = 'holidays';
const list = (lines: string[]) => h('ul', {}, ...lines.map((t) => h('li', {}, t)));

/**
 * Блок «Выходные дни» вкладки «Нормы и пороги»: сетка дней игры по неделям (пн–вс), нажатие переключает день в черновике,
 * «Сохранить» показывает последствия (итоги дней, питомцы сегодня), «Применить» пишет весь список разом (`setNonWorking`
 * заменяет его целиком). Запись идёт через общий поток записи страницы (`flow.write`): одна запись за раз, вкладки
 * заблокированы, снимок после неё перечитан и раздан виду. Пока поток занят или «устарел», «Сохранить» и «Применить»
 * недоступны; запись без ответа закрывается только повтором («Сохранить» → «Применить» ещё раз, список можно не менять:
 * сервер заменяет его целиком). `view` вкладка подключает к потоку (`opening.attach`).
 */
export function holidaysBlock(ctx: AdminCtx, first: Snapshot, checked: ReloadDone | null): { node: HTMLElement; view: FlowView<Snapshot> } {
  const flow = ctx.resultsFlow;
  let snap = first;
  const saved = (): DateStr[] => configOf(snap.config).nonWorking;
  let draft: DateStr[] = [...saved()]; // выходные на экране; на сервере то, что в снимке (`saved`)

  const alert = h('p', { role: 'alert', 'data-alert': KEY });
  const status = h('p', { role: 'status', 'data-status': KEY });
  if (checked?.error) alert.textContent = `Обновить не удалось: ${errorText(checked.error)}`;
  else if (checked?.checked) alert.textContent = INTERRUPTED_TEXT;
  const grid = h('div', { class: 'calendar', 'data-calendar': KEY });
  const previewBox = h('div', {});
  const staleLabel = h('span', {});
  const refreshButton = h('button', { type: 'button', 'data-refresh': KEY, onclick: () => void reload() }, 'Обновить');
  const staleBox = h('p', { role: 'alert', class: 'results-stale', 'data-stale': KEY, hidden: true }, staleLabel, ' ', refreshButton);
  const saveButton = h('button', { type: 'button', 'data-save': KEY, onclick: () => void showPreview() }, 'Сохранить');
  const node = h(
    'div',
    { class: 'holidays', 'data-block': KEY },
    h('h2', {}, 'Выходные дни'),
    h('p', { class: 'muted' }, 'Нажмите на день, чтобы сделать его выходным или рабочим; подчёркнут сегодняшний день. Перед записью покажем последствия.'),
    staleBox,
    grid,
    h('ul', { class: 'muted' }, ...NOTES.map((t) => h('li', {}, t))),
    saveButton,
    previewBox,
    alert,
    status,
  );

  /** Кнопки записи доступны, когда поток свободен и не «устарел» (повтор записи выходных без ответа — можно). */
  function lock(): void {
    const ok = flow.canWrite(KEY);
    saveButton.disabled = !ok;
    for (const b of node.querySelectorAll<HTMLButtonElement>('[data-confirm]')) b.disabled = !ok;
  }

  function paintGrid(): void {
    const today = serverToday(snap);
    const was = saved();
    const days = calendarWeeks({ ...configOf(snap.config), nonWorking: draft }).flat();
    grid.replaceChildren(
      ...WEEKDAYS.map((d) => h('span', { class: 'wd' }, d)),
      ...days.map(({ date, off }) => {
        const changed = was.includes(date) !== off;
        const word = off ? 'выходной' : 'рабочий';
        return h(
          'button',
          {
            type: 'button',
            class: ['day', off ? 'off' : '', changed ? 'changed' : '', date === today ? 'today' : ''].filter(Boolean).join(' '),
            'data-day': date,
            'aria-pressed': String(off),
            'aria-label': `${ruDate(date)}: ${word}${changed ? ' (изменено)' : ''}${date === today ? ', сегодня' : ''}`,
            onclick: () => toggle(date),
          },
          h('span', { class: 'n' }, shortDate(date)),
          h('span', { class: 'k' }, word),
        );
      }),
    );
  }

  function toggle(date: DateStr): void {
    draft = toggleDay(draft, date);
    alert.textContent = '';
    status.textContent = '';
    previewBox.replaceChildren();
    paintGrid();
  }

  /** «Сохранить»: свежий снимок, последствия смены календаря и «Применить» / «Отмена». На сервер пока ничего не уходит. */
  async function showPreview(): Promise<void> {
    alert.textContent = '';
    status.textContent = '';
    previewBox.replaceChildren();
    const wanted = [...draft];
    let fresh: Snapshot;
    try {
      fresh = await ctx.snapshot();
    } catch (e) {
      alert.textContent = errorText(e);
      return;
    }
    if (wanted.join() !== draft.join()) return; // пока читался снимок, день переключили: превью было бы по старому списку
    snap = fresh;
    paintGrid();
    const { added, removed } = calendarChanges(saved(), wanted);
    const apply = h('button', { type: 'button', 'data-confirm': KEY, disabled: !flow.canWrite(KEY), onclick: () => void write(wanted) }, 'Применить');
    if (!added.length && !removed.length) {
      // запись без ответа могла дойти: в снимке уже новый список, но поток снимается только повтором записи
      if (flow.unresolved === KEY) {
        previewBox.replaceChildren(h('div', { 'data-preview': KEY, role: 'group', 'aria-label': 'Повтор записи' },
          h('p', {}, 'На сервере уже этот список выходных. Нажмите «Применить», чтобы подтвердить запись.'), apply));
        return;
      }
      alert.textContent = 'Ничего не изменено';
      return;
    }
    const effects = calendarPreview(snap, wanted);
    previewBox.replaceChildren(h(
      'div',
      { 'data-preview': KEY, role: 'group', 'aria-label': 'Что изменится' },
      added.length ? h('p', {}, `Станут выходными: ${added.map(shortDate).join(', ')}.`) : null,
      removed.length ? h('p', {}, `Станут рабочими: ${removed.map(shortDate).join(', ')}.`) : null,
      h('h3', {}, 'Изменятся итоги дней'),
      effects.days.length ? list(effects.days.map(dayChangeText)) : h('p', {}, 'ничего: итоги оценённых дней те же.'),
      h('h3', {}, 'Что станет с питомцами сегодня'),
      h('p', {}, `У питомцев сегодня (${ruDate(serverToday(snap))}) изменится:`),
      effects.now.length ? list(effects.now.map(describeChange)) : h('p', {}, 'ничего: стадии, запасы и кучки сегодня те же.'),
      apply,
      h('button', { type: 'button', 'data-cancel': KEY, onclick: () => previewBox.replaceChildren() }, 'Отмена'),
    ));
  }

  /** «Применить»: запись через общий поток. */
  async function write(nonWorking: DateStr[]): Promise<void> {
    alert.textContent = '';
    status.textContent = '';
    try {
      const done = await flow.write(KEY, () => ctx.session.call('setNonWorking', { nonWorking }));
      previewBox.replaceChildren();
      if (done.refreshError) alert.textContent = `Выходные сохранены, но данные перечитать не удалось: ${errorText(done.refreshError)}. Нажмите «Обновить».`;
      else status.textContent = 'Сохранено';
    } catch (e) {
      // «устарело» и запись без ответа уже сказаны плашкой над сеткой: второй раз не повторяем
      if (e instanceof WriteRefused && flow.stale && e.message === flow.staleText) return;
      alert.textContent = e instanceof WriteRefused ? e.message : errorText(e);
    }
  }

  /** «Обновить»: повторить неотвеченную запись (если она есть) и прочитать снимок; вид получит его от потока. */
  async function reload(): Promise<void> {
    alert.textContent = '';
    status.textContent = '';
    try {
      const done = await flow.reload();
      if (done.error) alert.textContent = `Обновить не удалось: ${errorText(done.error)}`;
      else if (done.checked) alert.textContent = INTERRUPTED_TEXT;
      else status.textContent = 'Данные обновлены';
    } catch (e) {
      alert.textContent = e instanceof WriteRefused ? e.message : errorText(e);
    }
  }

  const view: FlowView<Snapshot> = {
    apply(fresh) {
      snap = fresh;
      previewBox.replaceChildren(); // превью считалось по прежнему снимку
      paintGrid();
    },
    setBusy(busy) {
      node.inert = busy;
      lock();
    },
    setStale(stale) {
      staleBox.hidden = !stale;
      staleLabel.textContent = flow.staleText;
      refreshButton.hidden = flow.unresolved !== null; // «Обновить» не снимает запись без ответа: нужен повтор
      lock();
    },
  };

  paintGrid();
  lock();
  return { node, view };
}
