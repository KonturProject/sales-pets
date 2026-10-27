import type { ConfigChange, Snapshot, SnapshotConfig } from '@/data/api';
import { configOf, dailyNormOf, timelineOf } from '@/data/config';
import { DEFAULT_DAILY_NORM } from '@/data/facts';
import type { DateStr } from '@/engine/types';
import {
  configFormOf, configPatch, LEVELS, LEVEL_TITLE, NORM_FIELD_TITLE, SCALAR_KEYS, SCALARS, type ConfigCurrent,
} from './configForm';
import { configPreview, describeChange, describeEntry, removalPreview, type ConfigPreview } from './configPreview';
import type { AdminCtx } from './ctx';
import { errorText, h, ruDate } from './dom';

/** Что действует на дату `from` (без даты — «вся игра», то есть база): с этих значений начинается форма. */
function currentAt(s: Snapshot, from: DateStr | undefined): ConfigCurrent {
  if (from === undefined) return { ...configOf(s.config), dailyNorm: dailyNormOf(s.config) ?? DEFAULT_DAILY_NORM };
  const timeline = timelineOf(s);
  return { ...timeline.at(from), dailyNorm: timeline.dailyNormAt(from) ?? DEFAULT_DAILY_NORM };
}

const changesOf = (s: Snapshot): ConfigChange[] => s.configChanges ?? [];

/**
 * Вкладка «Нормы и пороги»: поля предзаполнены тем, что реально действует (на выбранную дату или на всю игру), на сервер
 * уходит только изменённое. Диапазоны проверяет сервер: его отказ показывается как есть. Без даты правка действует на
 * всю историю, с датой — только с неё; в обоих случаях «Сохранить» сначала показывает, что изменится у питомцев сегодня,
 * и пишет на сервер только после «Применить». Ниже список правок по датам с кнопкой «Убрать».
 */
export async function normsTab(ctx: AdminCtx): Promise<HTMLElement> {
  let snap = await ctx.snapshot();
  const alert = h('p', { role: 'alert', 'data-alert': 'config' });
  const status = h('p', { role: 'status', 'data-status': 'config' });
  const box = h('div', {});
  const previewBox = h('div', {});
  const listBox = h('div', {});
  const { startDate, endDate } = configOf(snap.config);

  // вне перерисовываемой формы: выбранная дата переживает перерисовку, а смена даты перестраивает форму
  const fromInput = h('input', {
    type: 'date', 'data-field': 'from', min: startDate, max: endDate,
    onchange: () => {
      alert.textContent = '';
      status.textContent = '';
      previewBox.replaceChildren();
      paint();
    },
  });
  const chosen = (): DateStr | undefined => fromInput.value || undefined;

  const afterWrite = async (): Promise<void> => {
    snap = await ctx.snapshot();
    previewBox.replaceChildren();
    paint();
    paintList();
    status.textContent = 'Сохранено';
  };

  /** Окно «что изменится»: текст-пояснение, последствия для питомцев сегодня и «Применить» / «Отмена». */
  function showPreview(p: ConfigPreview, intro: string[], run: () => Promise<unknown>): void {
    const apply = h('button', { type: 'button', 'data-confirm': 'config' }, 'Применить');
    apply.addEventListener('click', () => {
      apply.disabled = true;
      run().then(afterWrite, (e) => {
        apply.disabled = false;
        alert.textContent = errorText(e);
      });
    });
    previewBox.replaceChildren(h(
      'div',
      { 'data-preview': 'config', role: 'group', 'aria-label': 'Что изменится' },
      ...intro.map((t) => h('p', {}, t)),
      ...(p.future ? [] : [
        h('p', {}, `У питомцев сегодня (${p.asOf}) изменится:`),
        p.changes.length
          ? h('ul', {}, ...p.changes.map((c) => h('li', {}, describeChange(c))))
          : h('p', {}, 'ничего: стадии, запасы и кучки сегодня те же.'),
      ]),
      apply,
      h('button', { type: 'button', 'data-cancel': 'config', onclick: () => previewBox.replaceChildren() }, 'Отмена'),
    ));
  }

  const evaluatedLine = (p: ConfigPreview, from: DateStr): string => (p.evaluatedDays
    ? `Пересчитаются оценки рабочих дней: ${p.evaluatedDays} (с ${ruDate(from)} по ${ruDate(p.evaluatedThrough!)}).`
    : 'Оценок рабочих дней, которые пересчитаются, нет: воронка за эти дни ещё не загружена.');

  function paint(): void {
    const from = chosen();
    const current = currentAt(snap, from);
    const start = configFormOf(current);
    const inputs = new Map<string, HTMLInputElement>();
    const input = (key: string, value: string, disabled = false) => {
      const el = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'data-field': key, value, disabled });
      inputs.set(key, el);
      return el;
    };
    const val = (key: string) => inputs.get(key)!.value;

    const scalars = SCALAR_KEYS.map((k) => h('label', {}, `${SCALARS[k]} `, input(k, start[k])));
    const norms = LEVELS.map((level) => h(
      'fieldset',
      {},
      h('legend', {}, LEVEL_TITLE[level]),
      ...(['quality', 'long'] as const).map((f) => h('label', {}, `${NORM_FIELD_TITLE[f]} `, input(`norm-${level}-${f}`, start.norms[level][f]))),
    ));
    const thresholds = start.stageThresholds.map((t, i) => h('label', {}, `Порог ${i + 1} `, input(`threshold-${i + 1}`, t, from !== undefined)));

    const save = (ev: Event) => {
      ev.preventDefault();
      alert.textContent = '';
      status.textContent = '';
      // у недописанной даты value пуст: без этой проверки правка ушла бы «на всю игру»
      if (fromInput.validity.badInput) {
        alert.textContent = 'Дата введена не полностью: выберите день или очистите поле';
        return;
      }
      const form = structuredClone(start);
      for (const k of SCALAR_KEYS) form[k] = val(k);
      for (const level of LEVELS) for (const f of ['quality', 'long'] as const) form.norms[level][f] = val(`norm-${level}-${f}`);
      form.stageThresholds = form.stageThresholds.map((_, i) => val(`threshold-${i + 1}`));
      const patch = configPatch(form, current, from);
      if ('error' in patch) {
        alert.textContent = patch.error;
        return;
      }
      previewBox.replaceChildren();
      ctx.snapshot().then(
        (snapshot) => {
          snap = snapshot;
          previewFor(patch, from);
        },
        (e) => { alert.textContent = errorText(e); },
      );
    };

    box.replaceChildren(h(
      'form',
      { 'data-form': 'config', onsubmit: save, oninput: () => previewBox.replaceChildren() },
      h('p', { 'data-warning': 'config' }, from === undefined
        ? 'Правка действует на всю историю игры: пересчитаются все прошлые дни. Перед записью покажем, что изменится у питомцев.'
        : `Правка действует с ${ruDate(from)}: дни до неё остаются как были. Перед записью покажем, что изменится у питомцев.`),
      h('h2', {}, 'Нормы оплат по уровням'),
      ...norms,
      h('h2', {}, 'Пороги'),
      ...scalars,
      h('h2', {}, 'Стадии: оплат до каждой'),
      from !== undefined && h('p', {}, 'Пороги стадий меняются только на всю игру: очистите дату, чтобы их править.'),
      h('div', { class: 'thresholds' }, ...thresholds),
      h('button', { type: 'submit', 'data-save': 'config' }, 'Сохранить'),
    ));
  }

  function previewFor(patch: SnapshotConfig, from: DateStr | undefined): void {
    const p = configPreview(snap, patch, from);
    const intro = from === undefined
      ? [
        'Правка пересчитает всю историю игры, а не только дни после неё.',
        ...(p.erased.length ? [`Записи по датам, в которых те же поля: ${p.erased.map(ruDate).join(', ')} — эти поля из них уберутся, иначе правка на всю игру не действовала бы после них.`] : []),
      ]
      : p.future
        ? [`Вступит в силу с ${ruDate(from)}, сегодня ничего не изменится.`]
        : [evaluatedLine(p, from)];
    showPreview(p, intro, () => ctx.session.call('setConfig', from === undefined ? { config: patch } : { config: patch, from }));
  }

  function removeFor(from: DateStr): void {
    alert.textContent = '';
    status.textContent = '';
    previewBox.replaceChildren();
    ctx.snapshot().then(
      (snapshot) => {
        snap = snapshot;
        const p = removalPreview(snap, from);
        const intro = [`Запись с ${ruDate(from)} будет убрана: с этой даты вернётся то, что действует до неё.`, ...(p.future ? ['Дата ещё не наступила, сегодня ничего не изменится.'] : [evaluatedLine(p, from)])];
        showPreview(p, intro, () => ctx.session.call('removeConfigChange', { from }));
      },
      (e) => { alert.textContent = errorText(e); },
    );
  }

  function paintList(): void {
    const changes = changesOf(snap);
    listBox.replaceChildren(
      h('h2', {}, 'Правки по датам'),
      changes.length
        ? h('ul', { 'data-list': 'config-changes' }, ...changes.map((c) => h(
          'li',
          { 'data-change': c.from },
          `${describeEntry(c)} `,
          h('button', { type: 'button', 'data-remove-change': c.from, onclick: () => removeFor(c.from) }, 'Убрать'),
        )))
        : h('p', {}, 'Правок по датам нет.'),
    );
  }

  paint();
  paintList();
  return h(
    'div',
    {},
    h('label', {}, 'Действует с даты (пусто — на всю игру) ', fromInput),
    box,
    previewBox,
    alert,
    status,
    listBox,
  );
}
