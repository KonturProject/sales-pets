import { serverToday } from '@/data/api';
import { groupOn, normalizeName, type Absence, type Employee } from '@/engine/staff';
import { GROUPS, type DateStr, type Level } from '@/engine/types';
import type { AdminCtx } from './ctx';
import { errorText, h, ruDate } from './dom';
import { fileBlock } from './importTab';
import { buildAbsence, buildStaffPatch, bulkStaffPatches, filterStaff, formOf, parseStaffJson, type BulkEdit, type StaffCurrent } from './staffForm';

const LEVEL_TITLE: Record<Level, string> = { experienced: 'Опытный', rookie1: 'Новичок 1', rookie2: 'Новичок 2' };
const KIND_TITLE: Record<Absence['kind'], string> = { vacation: 'Отпуск', sick: 'Больничный', other: 'Другое' };

interface Data {
  today: DateStr;
  staff: Employee[];
  absences: Absence[];
  reasons: Record<string, string>;
}

const field = (label: string, control: HTMLElement) => h('label', {}, `${label} `, control);
const option = (value: string, title: string, selected = false) => h('option', { value, selected }, title);

/**
 * Вкладка «Сотрудники»: поиск и карточка (приём, увольнение, перевод, уровень, исключение из рейтинга), отсутствия,
 * таблица уровней и дат приёма всего штата и загрузка списка из JSON. После каждой записи снимок и причины читаются заново и вкладка перерисовывается:
 * у админки нет опроса, `store` ей не нужен.
 */
export async function staffTab(ctx: AdminCtx): Promise<HTMLElement> {
  const load = async (): Promise<Data> => {
    const [snapshot, priv] = await Promise.all([
      ctx.snapshot(),
      ctx.session.call<{ hiddenReasons: Record<string, string> }>('getPrivate'),
    ]);
    return { today: serverToday(snapshot), staff: snapshot.staff, absences: snapshot.absences, reasons: priv.hiddenReasons };
  };
  let data = await load();
  let query = '';
  let selectedId: string | null = null;

  const alert = h('p', { role: 'alert', 'data-alert': 'staff-form' });
  const status = h('p', { role: 'status', 'data-status': 'staff-form' });
  const count = h('p', { 'data-staff-count': true });
  const list = h('ul', { 'data-staff-list': true });
  const card = h('section', { 'data-staff-card': true });

  const write = async (action: string, body: Record<string, unknown>): Promise<boolean> => {
    alert.textContent = '';
    status.textContent = '';
    try {
      await ctx.session.call(action, body);
      data = await load();
      paint();
      paintBulk();
      status.textContent = 'Сохранено';
      return true;
    } catch (e) {
      alert.textContent = errorText(e);
      return false;
    }
  };

  function paintList(): void {
    const found = filterStaff(data.staff, query);
    count.textContent = `Найдено: ${found.length} из ${data.staff.length}`;
    list.replaceChildren(...found.map((e) => h(
      'li',
      {},
      h('button', {
        type: 'button',
        'data-employee': e.id,
        'aria-pressed': e.id === selectedId,
        onclick: () => {
          selectedId = e.id;
          alert.textContent = '';
          status.textContent = '';
          paint();
        },
      }, `${e.name} — ${groupOn(e, data.today)}`),
    )));
  }

  function paintCard(): void {
    const e = data.staff.find((x) => x.id === selectedId);
    if (!e) return card.replaceChildren(h('p', {}, 'Выберите сотрудника из списка'));
    const current: StaffCurrent = { ...e, hiddenReason: data.reasons[e.id] ?? '' };
    const start = formOf(current);

    const hire = h('input', { type: 'date', 'data-field': 'hireDate', value: start.hireDate });
    const fire = h('input', { type: 'date', 'data-field': 'fireDate', value: start.fireDate });
    const level = h('select', { 'data-field': 'baseLevel' }, ...(Object.keys(LEVEL_TITLE) as Level[]).map((l) => option(l, LEVEL_TITLE[l], l === start.baseLevel)));
    const hidden = h('input', { type: 'checkbox', 'data-field': 'hiddenFromRating', checked: start.hiddenFromRating });
    const reason = h('input', { type: 'text', 'data-field': 'hiddenReason', maxlength: 200, value: start.hiddenReason });
    const transferDate = h('input', { type: 'date', 'data-field': 'transferDate' });
    const transferGroup = h('select', { 'data-field': 'transferGroup' }, option('', '—'), ...GROUPS.map((g) => option(g, g)));

    const save = (ev: Event) => {
      ev.preventDefault();
      const patch = buildStaffPatch(current, {
        hireDate: hire.value,
        fireDate: fire.value,
        baseLevel: level.value as Level,
        hiddenFromRating: hidden.checked,
        hiddenReason: reason.value,
        transferDate: transferDate.value,
        transferGroup: transferGroup.value as '' | (typeof GROUPS)[number],
      });
      if ('error' in patch) {
        status.textContent = '';
        alert.textContent = patch.error;
        return;
      }
      void write('setStaff', { staff: [patch] });
    };

    const kind = h('select', { 'data-field': 'absenceKind' }, ...(Object.keys(KIND_TITLE) as Absence['kind'][]).map((k) => option(k, KIND_TITLE[k])));
    const from = h('input', { type: 'date', 'data-field': 'absenceFrom' });
    const to = h('input', { type: 'date', 'data-field': 'absenceTo' });
    const addAbsence = (ev: Event) => {
      ev.preventDefault();
      const built = buildAbsence({ kind: kind.value, from: from.value, to: to.value });
      if ('error' in built) {
        status.textContent = '';
        alert.textContent = built.error;
        return;
      }
      void write('setAbsence', { employeeId: e.id, ...built });
    };

    const mine = data.absences.filter((a) => a.employeeId === e.id);
    card.replaceChildren(
      h('h2', {}, e.name),
      h('p', {}, `Сейчас в группе ${groupOn(e, data.today)}`),
      h(
        'form',
        { 'data-form': 'staff', onsubmit: save },
        field('Принят', hire),
        field('Уволен', fire),
        field('Уровень', level),
        h('label', {}, hidden, ' Исключить из рейтинга'),
        field('Причина (видна только админу)', reason),
        h('p', {}, e.transfers.length
          ? `Переводы: ${e.transfers.map((t) => `с ${ruDate(t.date)} — ${t.group}`).join('; ')}`
          : 'Переводов не было'),
        field('Перевод с даты', transferDate),
        field('в группу', transferGroup),
        h('button', { type: 'submit', 'data-save': 'staff' }, 'Сохранить'),
      ),
      h('h3', {}, 'Отсутствия'),
      h('ul', { 'data-absences': true }, ...mine.map((a) => h(
        'li',
        {},
        `${KIND_TITLE[a.kind]}: ${ruDate(a.from)} — ${a.to ? ruDate(a.to) : 'без даты окончания'} `,
        h('button', { type: 'button', 'data-remove': a.from, onclick: () => void write('removeAbsence', { employeeId: e.id, from: a.from }) }, 'Снять'),
      ))),
      h(
        'form',
        { 'data-form': 'absence', onsubmit: addAbsence },
        field('Тип', kind),
        field('С', from),
        field('По (можно пусто)', to),
        h('button', { type: 'submit', 'data-add': 'absence' }, 'Добавить'),
      ),
    );
  }

  function paint(): void {
    paintList();
    paintCard();
  }

  const search = h('input', {
    type: 'search',
    'data-staff-search': true,
    'aria-label': 'Поиск сотрудника',
    oninput: () => {
      query = search.value;
      paintList();
    },
  });

  const json = fileBlock('staff', 'Загрузить список из JSON', '.json,application/json', async (buf, show) => {
    const items = parseStaffJson(new TextDecoder().decode(buf));
    if ('error' in items) return show([items.error]);
    const known = new Set(data.staff.map((e) => normalizeName(e.name)));
    const added = items.filter((i) => !known.has(normalizeName(i.name))).length;
    show([`Записей: ${items.length}; новых: ${added}; обновится: ${items.length - added}`], {
      label: 'Загрузить',
      run: async () => {
        const done = await ctx.session.call<{ added: number; updated: number }>('setStaff', { staff: items });
        data = await load();
        paint();
        paintBulk();
        return [`Добавлено: ${done.added}; обновлено: ${done.updated}.`];
      },
    });
  });

  // таблица уровней и дат приёма: правки копятся в полях и уходят одной кнопкой; перерисовка — только после записи
  const bulkBody = h('tbody', {});
  const bulkSave = h('button', { type: 'button', 'data-bulk-save': true, onclick: () => void saveBulk() }, 'Сохранить изменения');
  const bulkAlert = h('p', { role: 'alert', 'data-alert': 'bulk' });
  const bulkStatus = h('p', { role: 'status', 'data-status': 'bulk' });
  let bulkFields = new Map<string, { level: HTMLSelectElement; hire: HTMLInputElement }>();
  const bulkEdits = (): Record<string, BulkEdit> =>
    Object.fromEntries([...bulkFields].map(([id, f]) => [id, { baseLevel: f.level.value as Level, hireDate: f.hire.value }]));
  const countBulk = () => {
    const result = bulkStaffPatches(data.staff, bulkEdits());
    bulkSave.textContent = 'error' in result ? 'Сохранить изменения' : `Сохранить изменения (${result.patches.length})`;
  };

  function paintBulk(): void {
    bulkFields = new Map();
    bulkBody.replaceChildren(...data.staff.map((e, i) => {
      const level = h('select', { 'data-bulk-level': e.id, 'aria-label': `Уровень, строка ${i + 1}`, onchange: countBulk },
        ...(Object.keys(LEVEL_TITLE) as Level[]).map((l) => option(l, LEVEL_TITLE[l], l === e.baseLevel)));
      const hire = h('input', { type: 'date', 'data-bulk-hire': e.id, value: e.hireDate ?? '', 'aria-label': `Дата приёма, строка ${i + 1}`, oninput: countBulk });
      bulkFields.set(e.id, { level, hire });
      return h('tr', { 'data-bulk-row': e.id }, h('td', {}, String(i + 1)), h('td', {}, e.name), h('td', {}, groupOn(e, data.today)), h('td', {}, level), h('td', {}, hire));
    }));
    countBulk();
  }

  async function saveBulk(): Promise<void> {
    bulkAlert.textContent = '';
    bulkStatus.textContent = '';
    const result = bulkStaffPatches(data.staff, bulkEdits());
    if ('error' in result) {
      bulkAlert.textContent = result.error;
      return;
    }
    if (!result.patches.length) {
      bulkStatus.textContent = 'Изменений нет';
      return;
    }
    bulkSave.disabled = true;
    try {
      await ctx.session.call('setStaff', { staff: result.patches });
      data = await load();
      paint();
      paintBulk();
      bulkStatus.textContent = `Сохранено строк: ${result.patches.length}`;
    } catch (e) {
      bulkAlert.textContent = errorText(e);
    } finally {
      bulkSave.disabled = false;
    }
  }

  const bulk = h(
    'section',
    { 'data-bulk': true },
    h('h2', {}, 'Уровни и даты приёма'),
    h('p', {}, 'Поправьте уровни и даты приёма всему штату и сохраните одной кнопкой. Новички без даты приёма оцениваются как опытные.'),
    h('table', { class: 'bulk' }, h('thead', {}, h('tr', {}, ...['№', 'Сотрудник', 'Группа', 'Уровень', 'Принят'].map((t) => h('th', {}, t)))), bulkBody),
    bulkSave,
    bulkAlert,
    bulkStatus,
  );

  paint();
  paintBulk();
  return h('div', {}, h('section', {}, h('h2', {}, 'Штат'), field('Поиск', search), count, list), card, alert, status, bulk, json);
}
