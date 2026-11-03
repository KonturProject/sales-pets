import { THEME } from '@/art/manifest';
import type { DateStr, GroupCode } from '@/engine/types';
import { errorText, h } from './dom';
import { KIND_TITLE, NEW_EMPLOYEE_PREFIX, correctionItems, type Cell, type EmployeeLine, type GroupLine, type Kind } from './results';
import { WriteRefused } from './resultsFlow';
import {
  ABSENT_FUNNEL_NOTE, LEVEL_TITLE, cellText, editorCaption, employeeMarks, nowLines, outcomeLines, shortDate,
  unassignedLines,
} from './resultsText';

const KINDS: Kind[] = ['quality', 'long', 'payments'];
/** Столбцов в таблице: группа, три за день, итог дня, три с начала игры, «Сейчас». */
const COLUMNS = 9;

export interface ResultsOpts {
  /** день таблицы: за него отправляются правки */
  date: DateStr;
  /** раскрытые группы; таблица меняет это множество при нажатии, хозяин держит его между перерисовками */
  open: Set<GroupCode>;
  /** «Сохранить» в редакторе: что должно стать у сотрудника. Нет обработчика — таблица только для чтения, без «Поправить». */
  onCorrect?: (line: EmployeeLine, wanted: Record<Kind, number>) => Promise<void>;
}

const text = (lines: string[]) => lines.map((line) => h('div', {}, line));

/** Ячейка «факт / план» с ✓/✗, пометками выходных, правок и устаревшей правки. */
function valueCell(c: Cell, key: string, note?: string, muted = false): HTMLElement {
  const t = cellText(c);
  return h(
    'td',
    { class: `num${muted ? ' muted' : ''}`, 'data-cell': key },
    h('span', {}, t.text),
    t.verdict && h('span', { class: `verdict ${t.verdict}`, 'aria-label': t.verdict === 'ok' ? 'выполнено' : 'не выполнено' }, t.verdict === 'ok' ? '✓' : '✗'),
    t.weekend && h('small', { class: 'sub' }, t.weekend),
    t.corrected && h('small', { class: 'sub corr' }, t.corrected),
    t.stale && h('small', { class: 'sub stale', title: 'Среди правок есть устаревшая — см. список правок ниже' }, '⚠ проверьте правку'),
    note && h('small', { class: 'sub' }, note),
  );
}

/** Введённое число; пустая строка и мусор — NaN (проверит `correctionItems`). */
const parseWanted = (value: string): number => (value.trim() === '' ? NaN : Number(value.trim().replace(',', '.')));

/**
 * Таблица итогов дня: строка группы (кнопка раскрытия) и под ней сотрудники. Всё берётся из готовых `GroupLine`:
 * цифры тут не считаются. Таблица лежит в контейнере с горизонтальной прокруткой, страница вбок не едет.
 */
export function renderResults(lines: GroupLine[], opts: ResultsOpts): HTMLElement {
  /** сотрудник, у которого открыт редактор, и его строка */
  let editor: { id: string; row: HTMLTableRowElement } | null = null;
  const closeEditor = () => {
    editor?.row.remove();
    editor = null;
  };

  function editorRow(e: EmployeeLine): HTMLTableRowElement {
    let busy = false;
    const funnelOff = (kind: Kind) => kind !== 'payments' && !e.inGroupTotal;
    const inputs = Object.fromEntries(KINDS.map((kind) => [kind, h('input', {
      type: 'number', min: 0, step: 1, inputmode: 'numeric', value: e.current[kind], disabled: funnelOff(kind),
      'data-edit': kind, 'aria-label': `${KIND_TITLE[kind]}: сколько должно быть`,
    })])) as Record<Kind, HTMLInputElement>;
    const alert = h('p', { role: 'alert', 'data-alert': 'correction' });
    const save = h('button', { type: 'submit', 'data-save': 'correction' }, 'Сохранить');
    const cancel = h('button', { type: 'button', 'data-cancel': 'correction', onclick: closeEditor }, 'Отмена');
    const lock = (locked: boolean) => {
      for (const kind of KINDS) inputs[kind].disabled = locked || funnelOff(kind);
      save.disabled = locked;
      cancel.disabled = locked;
    };

    const form = h(
      'form',
      {
        class: 'corr-editor',
        'data-editor': e.id,
        onsubmit: async (ev) => {
          ev.preventDefault();
          if (busy || !opts.onCorrect) return;
          alert.textContent = '';
          const wanted = Object.fromEntries(KINDS.map((kind) => [kind, parseWanted(inputs[kind].value)])) as Record<Kind, number>;
          const items = correctionItems(e, wanted, opts.date);
          if ('error' in items) return void (alert.textContent = items.error);
          if (items.length === 0) return void (alert.textContent = 'Ничего не изменено');
          busy = true;
          lock(true);
          try {
            await opts.onCorrect(e, wanted);
            closeEditor();
          } catch (err) {
            alert.textContent = err instanceof WriteRefused ? err.message : errorText(err);
          } finally {
            busy = false;
            lock(false);
          }
        },
      },
      h('p', { class: 'corr-title' }, `${e.name}: сколько должно быть за ${shortDate(opts.date)}`),
      h('div', { class: 'corr-fields' }, ...KINDS.map((kind) => h(
        'label',
        {},
        KIND_TITLE[kind],
        inputs[kind],
        h('small', { class: 'muted', 'data-caption': kind }, editorCaption(e.file[kind], e.corrections[kind])),
      ))),
      !e.inGroupTotal && h('p', { class: 'muted' }, ABSENT_FUNNEL_NOTE),
      e.day.payments.weekend ? h('p', { class: 'muted' }, `Оплаты здесь — только за ${shortDate(opts.date)}, без выходных; в таблице к ним добавлены выходные.`) : null,
      h('div', { class: 'corr-actions' }, save, cancel),
      alert,
    );
    return h('tr', { class: 'editor-row' }, h('td', { colspan: COLUMNS }, form));
  }

  function employeeRow(e: EmployeeLine): HTMLTableRowElement {
    const tr: HTMLTableRowElement = h('tr', { class: 'emp-row', 'data-employee-row': e.id });
    const marks = employeeMarks(e);
    const correctable = Boolean(opts.onCorrect) && !e.id.startsWith(NEW_EMPLOYEE_PREFIX);
    const edit = correctable && h('button', {
      type: 'button', class: 'small', 'data-correct': e.id,
      onclick: () => {
        const was = editor?.id === e.id;
        closeEditor();
        if (was) return;
        editor = { id: e.id, row: editorRow(e) };
        tr.after(editor.row);
        editor.row.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
      },
    }, 'Поправить');
    const off = !e.inGroupTotal; // воронка отсутствующего в итог группы не входит
    tr.append(
      h(
        'td',
        { class: 'who' },
        h('div', {}, h('span', { class: 'name' }, e.name), edit),
        h('div', { class: 'who-sub' }, h('small', { class: 'muted' }, LEVEL_TITLE[e.level]), ...marks.map((m) => h('small', { class: 'mark' }, m))),
      ),
      valueCell(e.day.quality, 'day-quality', undefined, off),
      valueCell(e.day.long, 'day-long', undefined, off),
      valueCell(e.day.payments, 'day-payments'),
      h('td', {}),
      valueCell(e.total.quality, 'total-quality'),
      valueCell(e.total.long, 'total-long'),
      valueCell(e.total.payments, 'total-payments'),
      h('td', {}),
    );
    return tr;
  }

  function groupBody(line: GroupLine): HTMLTableSectionElement {
    const tbody: HTMLTableSectionElement = h('tbody', { 'data-group': line.group, style: `--group: ${THEME[line.group].accent}` });
    let detail: HTMLTableRowElement[] = [];

    const toggle = h('button', {
      type: 'button', class: 'toggle', 'data-group-toggle': line.group, 'aria-expanded': String(opts.open.has(line.group)),
      onclick: () => {
        if (opts.open.has(line.group)) opts.open.delete(line.group);
        else opts.open.add(line.group);
        if (editor && line.employees.some((e) => e.id === editor!.id)) closeEditor();
        paintDetail();
      },
    });

    const percent = line.gamePlanPercent === null ? undefined : `${line.gamePlanPercent} % плана на игру`;
    const groupRow = h(
      'tr',
      { class: 'group-row' },
      h('td', { class: 'who' }, toggle),
      valueCell(line.day.quality, 'day-quality'),
      valueCell(line.day.long, 'day-long'),
      valueCell(line.day.payments, 'day-payments'),
      h('td', { class: 'text', 'data-outcome': line.group }, ...text(outcomeLines(line.outcome))),
      valueCell(line.total.quality, 'total-quality'),
      valueCell(line.total.long, 'total-long'),
      valueCell(line.total.payments, 'total-payments', percent),
      h('td', { class: 'text', 'data-now': line.group }, ...text(nowLines(line))),
    );

    function paintDetail(): void {
      const open = opts.open.has(line.group);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.replaceChildren(
        h('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
        h('b', {}, line.group),
        h('span', { class: 'muted' }, ` ${line.hero}`),
      );
      detail.forEach((r) => r.remove());
      detail = [];
      if (!open) return;
      detail = line.employees.map(employeeRow);
      if (detail.length === 0) detail.push(h('tr', { class: 'note-row' }, h('td', { colspan: COLUMNS, class: 'muted' }, 'В группе на этот день нет сотрудников')));
      const notes = unassignedLines(line.unassigned);
      if (notes.length) detail.push(h('tr', { class: 'note-row', 'data-unassigned': line.group }, h('td', { colspan: COLUMNS, class: 'muted' }, ...text(notes))));
      tbody.append(...detail);
    }

    tbody.append(groupRow);
    paintDetail();
    return tbody;
  }

  const head = h(
    'thead',
    {},
    h(
      'tr',
      {},
      h('th', { rowspan: 2, class: 'who' }, 'Группа'),
      h('th', { colspan: 3 }, 'За день'),
      h('th', { rowspan: 2 }, 'Итог дня'),
      h('th', { colspan: 3 }, 'С начала игры'),
      h('th', { rowspan: 2 }, 'Сейчас'),
    ),
    h('tr', {}, ...['Качеств.', 'Длинные', 'Оплаты', 'Качеств.', 'Длинные', 'Оплаты'].map((t) => h('th', {}, t))),
  );

  return h(
    'div',
    { class: 'results-view' },
    h('div', { class: 'results-scroll' }, h('table', { class: 'results' }, head, ...lines.map(groupBody))),
    h('p', { class: 'muted' }, 'Оплаты «с начала игры» считаются от старта игры; табло на ТВ считает с последнего вылупления, поэтому после гибели питомца числа различаются.'),
  );
}
