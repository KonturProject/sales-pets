import { serverToday, type Snapshot } from '@/data/api';
import { buildFacts } from '@/data/facts';
import { GROUPS, type GroupCode } from '@/engine/types';
import type { AdminCtx } from './ctx';
import { errorText, h, ruDate } from './dom';
import { describeOverride, overrideDelta, parseAmount, parseCoins, splitDelta, type OverrideKind } from './overridePlan';

const KINDS: { kind: OverrideKind; title: string; give: string; reset: string }[] = [
  { kind: 'piles', title: 'Кучки', give: 'Выдать кучку', reset: 'Сбросить кучки' },
  { kind: 'medkits', title: 'Аптечки', give: 'Выдать аптечку', reset: 'Сбросить аптечки' },
  { kind: 'toys', title: 'Игрушки', give: 'Выдать игрушку', reset: 'Сбросить игрушки' },
];
const RECENT = 20;

/**
 * Вкладка «Ручные правки»: выдать или сбросить кучки, аптечки и игрушки группы на дату. «Сбросить» — дельта
 * «минус то, что есть на эту дату» (состояние считает движок из снимка), ошибку гасит новая правка. Монеты для
 * магазина РГ только выдаются (минус забирает), одной записью; «Сейчас» у них — остаток группы на дату. Ниже — последние
 * правки и расходы РГ. Пока идёт запись, кнопки заблокированы: повторный клик не запишет вторую правку.
 */
export async function overridesTab(ctx: AdminCtx): Promise<HTMLElement> {
  let snapshot: Snapshot = await ctx.snapshot();
  const today = serverToday(snapshot);

  const alert = h('p', { role: 'alert', 'data-alert': 'overrides' });
  const status = h('p', { role: 'status', 'data-status': 'overrides' });
  const group = h('select', { 'data-field': 'group', onchange: () => paint() }, ...GROUPS.map((g) => h('option', { value: g }, g)));
  const date = h('input', { type: 'date', 'data-field': 'date', value: today, max: today, onchange: () => paint() });
  const amount = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'data-field': 'amount', value: '1' });
  const now = new Map<OverrideKind | 'coins', HTMLElement>();
  const buttons: HTMLButtonElement[] = [];
  const recent = h('tbody', {});
  let busy = false;

  async function apply(kind: OverrideKind | 'coins', mode: 'give' | 'reset'): Promise<void> {
    if (busy) return;
    alert.textContent = '';
    status.textContent = '';
    if (!date.value) return void (alert.textContent = 'Укажите дату');
    if (date.value > today) return void (alert.textContent = `Правки на будущее не принимаются: сегодня ${ruDate(today)}`);
    const g = group.value as GroupCode;
    let parts: number[];
    if (kind === 'coins') {
      const coins = parseCoins(amount.value);
      if (typeof coins !== 'number') return void (alert.textContent = coins.error);
      parts = [coins];
    } else {
      const parsed = mode === 'give' ? parseAmount(amount.value) : 0;
      if (typeof parsed !== 'number') return void (alert.textContent = parsed.error);
      const delta = overrideDelta(kind, mode, parsed, buildFacts(snapshot, date.value).states[g]);
      if (delta === 0) return void (alert.textContent = 'Сбрасывать нечего');
      parts = splitDelta(delta);
    }

    busy = true;
    buttons.forEach((b) => { b.disabled = true; });
    try {
      for (const part of parts) await ctx.session.call('setOverride', { date: date.value, group: g, kind, delta: part });
      status.textContent = 'Сохранено';
    } catch (e) {
      alert.textContent = errorText(e);
    }
    try {
      snapshot = await ctx.snapshot();
    } catch (e) {
      alert.textContent = errorText(e);
    }
    busy = false;
    buttons.forEach((b) => { b.disabled = false; });
    paint();
  }

  function paint(): void {
    const g = group.value as GroupCode;
    const facts = date.value ? buildFacts(snapshot, date.value) : undefined;
    for (const { kind } of KINDS) now.get(kind)!.textContent = facts ? String(facts.states[g][kind]) : '—';
    now.get('coins')!.textContent = facts ? String(facts.shop[g].balance) : '—';
    recent.replaceChildren(...snapshot.overrides.slice(-RECENT).reverse().map((o) => h(
      'tr',
      { 'data-override': o.id },
      h('td', {}, ruDate(o.date)),
      h('td', {}, o.group),
      h('td', {}, describeOverride(o).kind),
      h('td', {}, describeOverride(o).value),
    )));
  }

  const nowCell = (kind: OverrideKind | 'coins') => {
    const cell = h('td', { 'data-now': kind });
    now.set(kind, cell);
    return cell;
  };
  const button = (kind: OverrideKind | 'coins', text: string, mode: 'give' | 'reset') => {
    const b = h('button', { type: 'button', [`data-${mode}`]: kind, onclick: () => void apply(kind, mode) }, text);
    buttons.push(b);
    return b;
  };
  const rows = KINDS.map(({ kind, title, give, reset }) =>
    h('tr', {}, h('td', {}, title), nowCell(kind), h('td', {}, button(kind, give, 'give')), h('td', {}, button(kind, reset, 'reset'))));
  rows.push(h('tr', {}, h('td', {}, 'Монеты'), nowCell('coins'), h('td', {}, button('coins', 'Выдать монеты', 'give')), h('td', {})));

  paint();
  return h(
    'div',
    {},
    h('p', {}, 'Правка действует на выбранную дату; сегодня — ', ruDate(today), '.'),
    h('label', {}, 'Группа ', group),
    h('label', {}, 'Дата ', date),
    h('label', {}, 'Количество для «Выдать» (для монет можно с минусом) ', amount),
    h('table', { 'data-table': 'now' }, h('thead', {}, h('tr', {}, h('th', {}, 'Что'), h('th', {}, 'Сейчас'), h('th', {}), h('th', {}))), h('tbody', {}, ...rows)),
    alert,
    status,
    h('h2', {}, 'Последние правки и расходы РГ'),
    h('table', { 'data-table': 'overrides' }, h('thead', {}, h('tr', {}, h('th', {}, 'Дата'), h('th', {}, 'Группа'), h('th', {}, 'Что'), h('th', {}, 'Изменение'))), recent),
  );
}
