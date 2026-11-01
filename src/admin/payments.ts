import { THEME } from '@/art/manifest';
import { serverToday, type Snapshot } from '@/data/api';
import { GROUPS, type GroupCode } from '@/engine/types';
import type { AdminCtx } from './ctx';
import { errorText, h, ruDate } from './dom';

/** Верхняя граница `setProvisional` на сервере (`MAX_COUNT` в Code.gs). */
const MAX_COUNT = 10_000;

/** Предварительные числа оплат на «сегодня» по часам сервера; где ничего не внесено — 0. */
export function provisionalToday(s: Snapshot): Record<GroupCode, number> {
  const today = serverToday(s);
  const counts = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<GroupCode, number>;
  for (const p of s.provisional) if (p.date === today) counts[p.group] = p.count;
  return counts;
}

/** Из введённых строк — только изменённые группы с целым 0..10000; первое неверное значение останавливает всё. */
export function provisionalChanges(
  current: Record<GroupCode, number>,
  entered: Record<GroupCode, string>,
): { changes: { group: GroupCode; count: number }[] } | { error: string } {
  const changes: { group: GroupCode; count: number }[] = [];
  for (const group of GROUPS) {
    const text = entered[group].trim();
    if (!/^\d+$/.test(text) || Number(text) > MAX_COUNT) return { error: `${group}: введите целое число от 0 до ${MAX_COUNT}` };
    const count = Number(text);
    if (count !== current[group]) changes.push({ group, count });
  }
  return { changes };
}

/** Вкладка «Оплаты»: числа оплат групп за сегодня (предварительные, до загрузки отчёта). */
export async function paymentsTab(ctx: AdminCtx): Promise<HTMLElement> {
  const snapshot = await ctx.snapshot();
  let today = serverToday(snapshot);
  let current = provisionalToday(snapshot);
  const status = h('p', { role: 'status' });
  /** итог записи; ошибка и смена дня — красным */
  const say = (text: string, bad = false) => {
    status.textContent = text;
    status.classList.toggle('bad', bad);
  };
  const day = h('time', { 'data-today': today, datetime: today }, ruDate(today));
  const inputs = Object.fromEntries(
    GROUPS.map((g) => [g, h('input', {
      type: 'number', min: 0, max: MAX_COUNT, step: 1, value: current[g], 'data-pay': g, required: true,
      inputmode: 'numeric', 'aria-label': `${g}: оплат сегодня`, oninput: () => mark(),
    })]),
  ) as Record<GroupCode, HTMLInputElement>;
  /** несохранённые числа подсвечены */
  const mark = () => {
    for (const g of GROUPS) inputs[g].closest('.pay-card')?.classList.toggle('changed', inputs[g].value.trim() !== String(current[g]));
  };
  const step = (g: GroupCode, delta: number) => () => {
    inputs[g].value = String(Math.max(0, (Number(inputs[g].value) || 0) + delta));
    mark();
  };
  const card = (g: GroupCode) => h(
    'div',
    { class: 'pay-card', style: `--group: ${THEME[g].accent}` },
    h('div', { class: 'pay-head' }, h('b', {}, g), h('span', { class: 'muted' }, THEME[g].species)),
    h(
      'div',
      { class: 'pay-row' },
      h('button', { type: 'button', class: 'step', 'aria-label': `${g}: на одну меньше`, onclick: step(g, -1) }, '−'),
      inputs[g],
      h('button', { type: 'button', class: 'step', 'aria-label': `${g}: на одну больше`, onclick: step(g, 1) }, '+'),
    ),
  );

  const form = h(
    'form',
    {
      class: 'pay-form',
      onsubmit: (e) => {
        e.preventDefault();
        void save();
      },
    },
    h('h2', {}, 'Оплаты за сегодня, ', day),
    h('p', { class: 'muted' }, 'Сколько оплат у группы за сегодня — нарастающим итогом. Питомцы на экране реагируют сразу; утром файл оплат заменит эти числа точными.'),
    h('div', { class: 'pay-grid' }, ...GROUPS.map(card)),
    h('button', { type: 'submit' }, 'Сохранить'),
    status,
  );

  async function save(): Promise<void> {
    const entered = Object.fromEntries(GROUPS.map((g) => [g, inputs[g].value])) as Record<GroupCode, string>;
    const result = provisionalChanges(current, entered);
    if ('error' in result) {
      say(result.error, true);
      return;
    }
    // вкладку могли открыть вчера: числа пишутся только в сегодняшний день сервера.
    // День сверяется и без правок: те же числа, что со вчера, — это ещё не внесённый новый день
    let fresh: Snapshot;
    try {
      fresh = await ctx.snapshot();
    } catch (e) {
      say(errorText(e), true);
      return;
    }
    if (serverToday(fresh) !== today) {
      today = serverToday(fresh);
      current = provisionalToday(fresh);
      for (const g of GROUPS) inputs[g].value = String(current[g]);
      day.dateTime = today;
      day.dataset.today = today;
      day.textContent = ruDate(today);
      mark();
      say(`Наступило ${ruDate(today)}: в полях числа нового дня. Проверьте и сохраните ещё раз.`, true);
      return;
    }
    if (!result.changes.length) {
      say('Изменений нет');
      return;
    }
    const saved: GroupCode[] = [];
    try {
      for (const c of result.changes) {
        await ctx.session.call('setProvisional', { date: today, group: c.group, count: c.count });
        current[c.group] = c.count;
        saved.push(c.group);
      }
      say(`Сохранено в ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}: ${saved.join(', ')}`);
    } catch (e) {
      say(`${errorText(e)}${saved.length ? `. Уже сохранено: ${saved.join(', ')}` : ''}`, true);
    }
    mark();
  }

  return form;
}
