import type { Snapshot, SnapshotConfig } from '@/data/api';
import { configOf, dailyNormOf } from '@/data/config';
import { DEFAULT_DAILY_NORM } from '@/data/facts';
import {
  configFormOf, configPatch, LEVELS, LEVEL_TITLE, NORM_FIELD_TITLE, SCALAR_KEYS, SCALARS, type ConfigCurrent,
} from './configForm';
import { configPreview, describeChange } from './configPreview';
import type { AdminCtx } from './ctx';
import { errorText, h } from './dom';

const currentOf = (s: Snapshot): ConfigCurrent => ({
  ...configOf(s.config),
  dailyNorm: dailyNormOf(s.config) ?? DEFAULT_DAILY_NORM,
});

/**
 * Вкладка «Нормы и пороги»: поля предзаполнены тем, что реально действует (`configOf`), на сервер уходит только
 * изменённое. Диапазоны проверяет сервер: его отказ показывается как есть. Правка действует на всю историю, поэтому
 * «Сохранить» сначала показывает, что изменится у питомцев сегодня, и пишет на сервер только после «Применить».
 */
export async function normsTab(ctx: AdminCtx): Promise<HTMLElement> {
  let current = currentOf(await ctx.snapshot());
  const alert = h('p', { role: 'alert', 'data-alert': 'config' });
  const status = h('p', { role: 'status', 'data-status': 'config' });
  const box = h('div', {});
  const previewBox = h('div', {});

  function paint(): void {
    const start = configFormOf(current);
    const inputs = new Map<string, HTMLInputElement>();
    const input = (key: string, value: string) => {
      const el = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'data-field': key, value });
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
    const thresholds = start.stageThresholds.map((t, i) => h('label', {}, `Порог ${i + 1} `, input(`threshold-${i + 1}`, t)));

    const save = (ev: Event) => {
      ev.preventDefault();
      alert.textContent = '';
      status.textContent = '';
      const form = structuredClone(start);
      for (const k of SCALAR_KEYS) form[k] = val(k);
      for (const level of LEVELS) for (const f of ['quality', 'long'] as const) form.norms[level][f] = val(`norm-${level}-${f}`);
      form.stageThresholds = form.stageThresholds.map((_, i) => val(`threshold-${i + 1}`));
      const patch = configPatch(form, current);
      if ('error' in patch) {
        alert.textContent = patch.error;
        return;
      }
      previewBox.replaceChildren();
      ctx.snapshot().then(
        (snapshot) => showPreview(patch, snapshot),
        (e) => { alert.textContent = errorText(e); },
      );
    };

    const showPreview = (patch: SnapshotConfig, snapshot: Snapshot) => {
      const { asOf, changes } = configPreview(snapshot, patch);
      const apply = h('button', { type: 'button', 'data-confirm': 'config' }, 'Применить');
      apply.addEventListener('click', () => {
        apply.disabled = true;
        ctx.session.call('setConfig', { config: patch }).then(
          async () => {
            current = currentOf(await ctx.snapshot());
            previewBox.replaceChildren();
            paint();
            status.textContent = 'Сохранено';
          },
          (e) => {
            apply.disabled = false;
            alert.textContent = errorText(e);
          },
        );
      });
      previewBox.replaceChildren(h(
        'div',
        { 'data-preview': 'config', role: 'group', 'aria-label': 'Что изменится' },
        h('p', {}, `Правка пересчитает всю историю игры, а не только дни после неё. У питомцев сегодня (${asOf}) изменится:`),
        changes.length
          ? h('ul', {}, ...changes.map((c) => h('li', {}, describeChange(c))))
          : h('p', {}, 'ничего: стадии, запасы и кучки сегодня те же. Прошлые дни могут пересчитаться.'),
        apply,
        h('button', { type: 'button', 'data-cancel': 'config', onclick: () => previewBox.replaceChildren() }, 'Отмена'),
      ));
    };

    box.replaceChildren(h(
      'form',
      { 'data-form': 'config', onsubmit: save, oninput: () => previewBox.replaceChildren() },
      h('p', { 'data-warning': 'config' }, 'Правка действует на всю историю игры: пересчитаются все прошлые дни. Перед записью покажем, что изменится у питомцев.'),
      h('h2', {}, 'Нормы оплат по уровням'),
      ...norms,
      h('h2', {}, 'Пороги'),
      ...scalars,
      h('h2', {}, 'Стадии: оплат до каждой'),
      h('div', { class: 'thresholds' }, ...thresholds),
      h('button', { type: 'submit', 'data-save': 'config' }, 'Сохранить'),
    ));
  }

  paint();
  return h('div', {}, box, previewBox, alert, status);
}
