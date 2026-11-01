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
  const day = h('time', { 'data-today': today, datetime: today }, ruDate(today));
  const inputs = Object.fromEntries(
    GROUPS.map((g) => [g, h('input', { type: 'number', min: 0, max: MAX_COUNT, step: 1, value: current[g], 'data-pay': g, required: true })]),
  ) as Record<GroupCode, HTMLInputElement>;

  const form = h(
    'form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        void save();
      },
    },
    h('p', {}, 'Сегодня: ', day),
    ...GROUPS.map((g) => h('label', {}, g, ' ', inputs[g])),
    h('button', { type: 'submit' }, 'Сохранить'),
    status,
  );

  async function save(): Promise<void> {
    const entered = Object.fromEntries(GROUPS.map((g) => [g, inputs[g].value])) as Record<GroupCode, string>;
    const result = provisionalChanges(current, entered);
    if ('error' in result) {
      status.textContent = result.error;
      return;
    }
    if (!result.changes.length) {
      status.textContent = 'Изменений нет';
      return;
    }
    // вкладку могли открыть вчера: числа пишутся только в сегодняшний день сервера
    let fresh: Snapshot;
    try {
      fresh = await ctx.snapshot();
    } catch (e) {
      status.textContent = errorText(e);
      return;
    }
    if (serverToday(fresh) !== today) {
      today = serverToday(fresh);
      current = provisionalToday(fresh);
      for (const g of GROUPS) inputs[g].value = String(current[g]);
      day.dateTime = today;
      day.dataset.today = today;
      day.textContent = ruDate(today);
      status.textContent = `Наступило ${ruDate(today)}: в полях числа нового дня. Проверьте и сохраните ещё раз.`;
      return;
    }
    const saved: GroupCode[] = [];
    try {
      for (const c of result.changes) {
        await ctx.session.call('setProvisional', { date: today, group: c.group, count: c.count });
        current[c.group] = c.count;
        saved.push(c.group);
      }
      status.textContent = `Сохранено: ${saved.join(', ')}`;
    } catch (e) {
      status.textContent = `${errorText(e)}${saved.length ? `. Уже сохранено: ${saved.join(', ')}` : ''}`;
    }
  }

  return form;
}
