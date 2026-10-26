import { ApiError, serverToday } from '@/data/api';
import { configOf } from '@/data/config';
import type { AdminCtx } from './ctx';
import { errorText, h, ruDate } from './dom';
import { planFunnelImport, planPaymentsImport } from './importPlan';

/** Ответ `importPayments`; для `dryRun` те же счётчики без записи. */
interface PaymentsReply { added: number; ignored: number; removed: number; removedProvisional: number }

const importError = (e: unknown): string =>
  e instanceof ApiError && e.code === 'bad_request'
    ? 'Файл отклонён сервером: проверьте, что это нужный отчёт и даты'
    : errorText(e);

/**
 * Блок «выбрать файл → разобрать → показать счётчики → подтвердить». `onFile` получает содержимое файла и
 * говорит `show(строки, действие)`; действие — кнопка подтверждения, её подпись и вызов. ФИО на экран не выводятся.
 */
function fileBlock(id: string, title: string, accept: string, onFile: (buf: ArrayBuffer, show: Show) => Promise<void>): HTMLElement {
  const report = h('div', { 'data-report': id, role: 'status' });
  const alert = h('p', { role: 'alert', 'data-alert': id });
  const input = h('input', {
    type: 'file',
    accept,
    'data-file': id,
    onchange: () => void choose(),
  });

  const fail = (text: string) => {
    report.replaceChildren();
    alert.textContent = text;
  };
  const show: Show = (lines, action) => {
    alert.textContent = '';
    const nodes: Node[] = lines.map((t) => h('p', {}, t));
    if (action) {
      const button = h('button', {
        type: 'button',
        'data-confirm': id,
        onclick: () => {
          button.disabled = true;
          alert.textContent = '';
          action.run().then(
            (done) => report.replaceChildren(...done.map((t) => h('p', {}, t))),
            (e) => {
              alert.textContent = importError(e);
              button.disabled = false;
            },
          );
        },
      }, action.label);
      nodes.push(button);
    }
    report.replaceChildren(...nodes);
  };

  async function choose(): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    report.replaceChildren();
    alert.textContent = '';
    try {
      const buf = await file.arrayBuffer();
      await onFile(buf, show);
    } catch (e) {
      fail(e instanceof ApiError ? importError(e) : e instanceof Error ? `Не тот файл или он повреждён: ${e.message}` : errorText(e));
    } finally {
      input.value = '';
    }
  }

  return h('section', {}, h('h2', {}, title), h('label', {}, input), report, alert);
}

type Show = (lines: string[], action?: { label: string; run: () => Promise<string[]> }) => void;

/** Вкладка «Импорт»: выгрузка оплат и отчёт воронки из xlsx. Разбор файла — в браузере, на сервер уходят только факты. */
export async function importTab(ctx: AdminCtx): Promise<HTMLElement> {
  const xlsx = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const payments = fileBlock('payments', 'Оплаты: «Детальные данные по оплаченным счетам»', xlsx, async (buf, show) => {
    const snapshot = await ctx.snapshot();
    const { parsePaymentsXlsx } = await import('@/import/payments');
    const parsed = parsePaymentsXlsx(buf);
    const plan = planPaymentsImport(parsed, { today: serverToday(snapshot), startDate: configOf(snapshot.config).startDate });
    if ('error' in plan) return show([plan.error]);
    const body = { from: plan.from, to: plan.to, rows: plan.rows };
    const preview = await ctx.session.call<PaymentsReply>('importPayments', { ...body, dryRun: true });
    show(
      [
        `Период: ${ruDate(plan.from)} — ${ruDate(plan.to)}`,
        `Оплат к загрузке: ${preview.added}; заменится прежних: ${preview.removed}; уберётся предварительных чисел: ${preview.removedProvisional}`,
        `Не засчитано в файле: ${parsed.skipped.length}; вне периода: ${plan.dropped + preview.ignored}`,
      ],
      {
        label: 'Загрузить',
        run: async () => {
          const done = await ctx.session.call<PaymentsReply>('importPayments', body);
          return [`Загружено оплат: ${done.added}. Период ${ruDate(plan.from)} — ${ruDate(plan.to)}.`];
        },
      },
    );
  });

  const funnel = fileBlock('funnel', 'Воронка: «АП_НП_СР_Воронка_Дни…»', xlsx, async (buf, show) => {
    const snapshot = await ctx.snapshot();
    const { parseFunnelXlsx } = await import('@/import/funnel');
    const parsed = parseFunnelXlsx(buf);
    const plan = planFunnelImport(parsed, snapshot.staff, { today: serverToday(snapshot), config: configOf(snapshot.config) });
    if ('error' in plan) return show([plan.error]);
    const fresh = plan.newStaff;
    const lines = [
      `Данные по ${ruDate(plan.through)} включительно; сотрудников в файле: ${parsed.employees.length}; строк к загрузке: ${plan.rows.length}`,
      `Вне шести групп: ${plan.outside}; позже ${ruDate(plan.through)} (не загружаются): ${plan.dropped}`,
    ];
    if (fresh.length) lines.push(`Новых сотрудников: ${fresh.length}. Они будут добавлены в штат в группах из файла, уровень «опытный».`);
    show(lines, {
      label: fresh.length ? `Добавить новых (${fresh.length}) в штат и загрузить` : 'Загрузить',
      run: async () => {
        if (fresh.length) await ctx.session.call('setStaff', { staff: fresh });
        const done = await ctx.session.call<{ added: number }>('importFunnel', { through: plan.through, rows: plan.rows });
        return [`Загружено строк воронки: ${done.added}${fresh.length ? `; добавлено сотрудников: ${fresh.length}` : ''}.`];
      },
    });
  });

  return h('div', {}, payments, funnel);
}
