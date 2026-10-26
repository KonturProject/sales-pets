import type { Snapshot } from '@/data/api';
import { configOf, dailyNormOf } from '@/data/config';
import { DEFAULT_DAILY_NORM } from '@/data/facts';
import {
  configFormOf, configPatch, LEVELS, LEVEL_TITLE, NORM_FIELD_TITLE, SCALAR_KEYS, SCALARS, type ConfigCurrent,
} from './configForm';
import type { AdminCtx } from './ctx';
import { errorText, h } from './dom';

const currentOf = (s: Snapshot): ConfigCurrent => ({
  ...configOf(s.config),
  dailyNorm: dailyNormOf(s.config) ?? DEFAULT_DAILY_NORM,
});

/**
 * Вкладка «Нормы и пороги»: поля предзаполнены тем, что реально действует (`configOf`), на сервер уходит только
 * изменённое. Диапазоны проверяет сервер: его отказ показывается как есть. Правка действует на всю историю.
 */
export async function normsTab(ctx: AdminCtx): Promise<HTMLElement> {
  let current = currentOf(await ctx.snapshot());
  const alert = h('p', { role: 'alert', 'data-alert': 'config' });
  const status = h('p', { role: 'status', 'data-status': 'config' });
  const box = h('div', {});

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
      ctx.session.call('setConfig', { config: patch }).then(
        async () => {
          current = currentOf(await ctx.snapshot());
          paint();
          status.textContent = 'Сохранено';
        },
        (e) => { alert.textContent = errorText(e); },
      );
    };

    box.replaceChildren(h(
      'form',
      { 'data-form': 'config', onsubmit: save },
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
  return h('div', {}, box, alert, status);
}
