import { ApiError, serverToday } from '@/data/api';
import { configOf } from '@/data/config';
import { GROUPS, type GroupCode } from '@/engine/types';
import type { AdminCtx } from './ctx';
import { errorText, h, ruDate } from './dom';
import { paymentsSummary, planFunnelImport, planPaymentsImport, withFunnelImport, withPaymentsImport, type FunnelPlan } from './importPlan';
import { createPreviews } from './importPreview';
import { INTERRUPTED_TEXT } from './resultsFlow';

/** Ответ `importPayments`; для `dryRun` те же счётчики без записи. */
interface PaymentsReply { added: number; ignored: number; removed: number; removedProvisional: number }

type Person = { name: string; group: GroupCode };
const byGroup = (people: Person[]) => GROUPS.map((g) => `${g} ${people.filter((p) => p.group === g).length}`).join(' · ');
/** Новые ФИО по группам — строкой на группу, чтобы глазами сверить написание. */
const namesByGroup = (people: Person[]) =>
  GROUPS.flatMap((g) => {
    const names = people.filter((p) => p.group === g).map((p) => p.name);
    return names.length ? [`${g}: ${names.join('; ')}`] : [];
  });

const importError = (e: unknown): string =>
  e instanceof ApiError && e.code === 'bad_request'
    ? 'Файл отклонён сервером: проверьте, что это нужный отчёт и даты'
    : errorText(e);

/**
 * Блок «выбрать файл → разобрать → показать счётчики → подтвердить». `onFile` получает содержимое файла и
 * говорит `show(строки, действие, разбор)`; действие — кнопка подтверждения, её подпись и вызов; разбор — узел между
 * строками и кнопкой, его хозяин перерисовывает на месте, а кнопка остаётся. ФИО на экран не выводятся.
 */
export function fileBlock(id: string, title: string, accept: string, onFile: (buf: ArrayBuffer, show: Show) => Promise<void>, hint?: string): HTMLElement {
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
  const show: Show = (lines, action, preview) => {
    alert.textContent = '';
    const nodes: Node[] = lines.map((t) => h('p', {}, t));
    if (preview) nodes.push(preview);
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

  return h('section', {}, h('h2', {}, title), hint ? h('p', { class: 'muted' }, hint) : null, h('label', { class: 'file' }, input), report, alert);
}

export type Show = (lines: string[], action?: { label: string; run: () => Promise<string[]> }, preview?: Node) => void;

/**
 * Вкладка «Импорт»: выгрузка оплат и отчёт воронки из xlsx. Разбор файла — в браузере, на сервер уходят только факты.
 * После разбора показано, что получится после загрузки (таблица «Итогов», изменения, устаревшие правки), и там можно
 * поправить факт: правка пишется через общий поток записи страницы, как во вкладке «Итоги». Как и она, вкладка при
 * открытии сначала выясняет потерянную запись и лишь потом читает первый снимок.
 */
export async function importTab(ctx: AdminCtx): Promise<HTMLElement> {
  const xlsx = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const opening = ctx.resultsFlow.begin();
  const checked = await opening.open();
  const previews = createPreviews(ctx.resultsFlow);

  const payments = fileBlock('payments', '2. Оплаты: «Детальные данные по оплаченным счетам»', xlsx, async (buf, show) => {
    const since = previews.mark();
    const snapshot = await ctx.snapshot();
    const { parsePaymentsXlsx } = await import('@/import/payments');
    const parsed = parsePaymentsXlsx(buf);
    const plan = planPaymentsImport(parsed, { today: serverToday(snapshot), startDate: configOf(snapshot.config).startDate });
    if ('error' in plan) return show([plan.error]);
    const body = { from: plan.from, to: plan.to, rows: plan.rows };
    const preview = await ctx.session.call<PaymentsReply>('importPayments', { ...body, dryRun: true });
    // период не плывёт от пересчёта к пересчёту: он тот же, что в теле запроса «Загрузить»
    const table = previews.add({
      id: 'payments',
      compute: (s) => ({ before: s, after: withPaymentsImport(s, plan), date: plan.to, period: { from: plan.from, to: plan.to } }),
    }, snapshot, since);
    show(
      [
        `Период: ${ruDate(plan.from)} — ${ruDate(plan.to)}`,
        `Оплат к загрузке: ${preview.added}; заменится прежних: ${preview.removed}; уберётся предварительных чисел: ${preview.removedProvisional}`,
        `Не засчитано в файле: ${parsed.skipped.length}; вне периода: ${plan.dropped + preview.ignored}`,
        ...paymentsSummary(plan.rows, snapshot.staff),
      ],
      {
        label: 'Загрузить',
        run: async () => {
          const done = await ctx.session.call<PaymentsReply>('importPayments', body);
          return [`Загружено оплат: ${done.added}. Период ${ruDate(plan.from)} — ${ruDate(plan.to)}.`];
        },
      },
      table,
    );
  }, 'После воронки, каждое утро: оплаты по вчерашний день. Повторная загрузка периода заменяет его, предварительные числа этих дней заменятся файлом.');

  const funnel = fileBlock('funnel', '1. Воронка: «АП_НП_СР_Воронка_Дни…»', xlsx, async (buf, show) => {
    const since = previews.mark();
    const snapshot = await ctx.snapshot();
    const { parseFunnelXlsx } = await import('@/import/funnel');
    const parsed = parseFunnelXlsx(buf);
    const today = serverToday(snapshot);
    const config = configOf(snapshot.config);
    const first = planFunnelImport(parsed, snapshot.staff, { today, config });
    if ('error' in first) return show([first.error]);
    if ('staffOnly' in first) {
      const fresh = first.newStaff;
      return show(
        [
          'Первая загрузка: показателей за дни игры в файле ещё нет, из него берётся только штат.',
          `Сотрудников в файле: ${first.inFile}; уже в штате: ${first.inFile - fresh.length}; новых: ${fresh.length} — ${byGroup(fresh)}. Вне шести групп: ${first.outside}.`,
          ...namesByGroup(fresh),
          'Новые добавятся уровнем «опытный» без даты приёма. После этого: Сотрудники → «Уровни и даты приёма» — новичкам уровень и дату приёма; кто уже уволен — дату увольнения в карточке.',
        ],
        {
          label: `Добавить в штат (${fresh.length})`,
          run: async () => {
            await ctx.session.call('setStaff', { staff: fresh });
            return [
              `Добавлено в штат: ${fresh.length} — ${byGroup(fresh)}.`,
              'Дальше: Сотрудники → «Уровни и даты приёма». Показатели воронки загружайте этим же блоком со следующего рабочего дня.',
            ];
          },
        },
      );
    }
    // после правки снимок читается заново: новые сотрудники берутся из последнего расчёта с тем же файлом,
    // «сегодня» — на момент выбора файла, поэтому день файла не плывёт
    let plan: FunnelPlan = first;
    const preview = previews.add({
      id: 'funnel',
      compute: (s) => {
        const next = planFunnelImport(parsed, s.staff, { today, config });
        if ('error' in next || 'staffOnly' in next) return { message: 'Файл больше не подходит для загрузки: выберите его ещё раз' };
        plan = next;
        return { before: s, after: withFunnelImport(s, next), date: next.through };
      },
    }, snapshot, since);
    const fresh = plan.newStaff;
    const lines = [
      `Данные по ${ruDate(plan.through)} включительно; сотрудников в файле: ${parsed.employees.length}; строк к загрузке: ${plan.rows.length}`,
      `Вне шести групп: ${plan.outside}; позже ${ruDate(plan.through)} (не загружаются): ${plan.dropped}`,
    ];
    if (plan.zeroThrough) lines.unshift(`Внимание: за ${ruDate(plan.through)} у всех сотрудников нули — похоже, отчёт выгружен до обновления CRM. Загрузка оценит этот день нулями; лучше скачайте свежий отчёт. Если загрузили по ошибке, повторная загрузка правильного файла перезапишет эти дни.`);
    if (fresh.length) {
      lines.push(`Новых сотрудников: ${fresh.length} — ${byGroup(fresh)}. Они будут добавлены в штат в группах из файла, уровень «опытный», без даты приёма. Новичкам дату приёма и уровень поставьте во вкладке «Сотрудники»: иначе норма группы считается как для опытных.`);
      lines.push(...namesByGroup(fresh), 'Сверьте написание с штатом: опечатка создаст двойника.');
    }
    show(lines, {
      label: fresh.length ? `Добавить новых (${fresh.length}) в штат и загрузить` : 'Загрузить',
      run: async () => {
        const { newStaff, through, rows } = plan;
        if (newStaff.length) await ctx.session.call('setStaff', { staff: newStaff });
        const done = await ctx.session.call<{ added: number }>('importFunnel', { through, rows });
        return [`Загружено строк воронки: ${done.added}${newStaff.length ? `; добавлено сотрудников: ${newStaff.length}` : ''}.`];
      },
    }, preview);
  }, 'Каждое утро: отчёт по последний рабочий день. Первая загрузка (02.11) берёт из отчёта только штат; новые люди из отчёта добавляются в штат и в следующие дни.');

  const alert = h('p', { role: 'alert', 'data-alert': 'import-open' });
  const root = h('div', {}, alert, funnel, payments);
  if (!opening.attach(previews.view)) return h('div'); // открытие успели сменить более новым: этот экземпляр на экран не попадёт
  if (checked?.error) alert.textContent = `Обновить не удалось: ${errorText(checked.error)}`;
  else if (checked?.checked) alert.textContent = INTERRUPTED_TEXT;
  return root;
}
