import { parseDate } from '@/engine/calendar';
import { normalizeName, type Absence, type Employee } from '@/engine/staff';
import { GROUPS, type DateStr, type GroupCode, type Level } from '@/engine/types';

const LEVELS: Level[] = ['experienced', 'rookie1', 'rookie2'];
const KINDS: Absence['kind'][] = ['vacation', 'sick', 'other'];
/** Как `HIDDEN_REASON_MAX` в `Code.gs`: длиннее сервер отклонит. */
const HIDDEN_REASON_MAX = 200;
const JSON_KEYS = new Set(['name', 'group', 'hireDate', 'fireDate', 'baseLevel', 'hiddenFromRating', 'hiddenReason']);

type Transfer = Employee['transfers'][number];
export type Failure = { error: string };

/** Сотрудник из снимка вместе с причиной исключения из рейтинга (она приходит отдельно, из `getPrivate`). */
export type StaffCurrent = Employee & { hiddenReason: string };

/** Значения полей карточки: даты строками (`''` — нет даты), перевод — новая запись. */
export interface StaffForm {
  hireDate: string;
  fireDate: string;
  baseLevel: Level;
  hiddenFromRating: boolean;
  hiddenReason: string;
  transferDate: string;
  transferGroup: GroupCode | '';
}

/** Элемент `setStaff`: ключ — ФИО, дальше только изменённые поля. */
export type StaffPatch = { name: string } & Partial<{
  hireDate: DateStr | null;
  fireDate: DateStr | null;
  baseLevel: Level;
  hiddenFromRating: boolean;
  hiddenReason: string;
  transfers: Transfer[];
}>;

export const formOf = (e: StaffCurrent): StaffForm => ({
  hireDate: e.hireDate ?? '',
  fireDate: e.fireDate ?? '',
  baseLevel: e.baseLevel,
  hiddenFromRating: e.hiddenFromRating,
  hiddenReason: e.hiddenReason,
  transferDate: '',
  transferGroup: '',
});

/** Поиск без регистра и лишних пробелов по ФИО и короткому имени; пустой запрос — все. */
export function filterStaff<T extends Pick<Employee, 'name' | 'shortName'>>(staff: T[], query: string): T[] {
  const q = normalizeName(query);
  if (q === '') return staff;
  return staff.filter((e) => normalizeName(e.name).includes(q) || normalizeName(e.shortName).includes(q));
}

/** Пустая строка — нет даты (`null`); не дата — `'bad'`. */
function readDate(raw: string): DateStr | null | 'bad' {
  const v = raw.trim();
  return v === '' ? null : parseDate(v, '') || 'bad';
}

/**
 * Что отправить в `setStaff` по карточке: только изменённое. Приём — `hireDate`, увольнение — `fireDate`, отмена
 * увольнения — `fireDate: null`; перевод добавляется к прежним (на ту же дату — заменяет). Скрытие из рейтинга без
 * причины — ошибка: сервер её не примет, лучше сказать сразу.
 */
export function buildStaffPatch(current: StaffCurrent, form: StaffForm): StaffPatch | Failure {
  const patch: StaffPatch = { name: current.name };

  const hire = readDate(form.hireDate);
  const fire = readDate(form.fireDate);
  if (hire === 'bad') return { error: 'Дата приёма: ожидается дата вида 2026-11-09' };
  if (fire === 'bad') return { error: 'Дата увольнения: ожидается дата вида 2026-11-09' };
  if (hire !== current.hireDate) patch.hireDate = hire;
  if (fire !== current.fireDate) patch.fireDate = fire;
  if (hire !== null && fire !== null && fire <= hire) return { error: 'Увольнение должно быть позже приёма' };

  if (form.baseLevel !== current.baseLevel) patch.baseLevel = form.baseLevel;

  const reason = form.hiddenReason.trim();
  if (form.hiddenFromRating) {
    if (reason === '') return { error: 'Укажите причину исключения из рейтинга' };
    if (reason.length > HIDDEN_REASON_MAX) return { error: `Причина длиннее ${HIDDEN_REASON_MAX} знаков` };
    if (!current.hiddenFromRating) {
      patch.hiddenFromRating = true;
      patch.hiddenReason = reason;
    } else if (reason !== current.hiddenReason) patch.hiddenReason = reason;
  } else if (current.hiddenFromRating) patch.hiddenFromRating = false;

  const transferDate = readDate(form.transferDate);
  if (transferDate === 'bad') return { error: 'Дата перевода: ожидается дата вида 2026-11-09' };
  if (transferDate !== null || form.transferGroup !== '') {
    if (transferDate === null) return { error: 'Перевод: укажите дату' };
    if (!GROUPS.includes(form.transferGroup as GroupCode)) return { error: 'Перевод: выберите группу' };
    patch.transfers = [...current.transfers.filter((t) => t.date !== transferDate), { date: transferDate, group: form.transferGroup as GroupCode }]
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  return Object.keys(patch).length === 1 ? { error: 'Ничего не изменено' } : patch;
}

export type StaffItem = { name: string; group: GroupCode } & Partial<Omit<StaffPatch, 'transfers' | 'name'>>;

/**
 * Список для `setStaff` из JSON-файла. Проверка до отправки: группа из шести, даты, уровень, причина при скрытии,
 * неизвестные поля, повтор ФИО. В тексте ошибок — только номер записи (1…N), без ФИО и без цитат из файла.
 */
export function parseStaffJson(text: string): StaffItem[] | Failure {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'Файл не похож на JSON' };
  }
  if (!Array.isArray(data) || data.length === 0) return { error: 'Ожидается непустой список записей: [ { "name": …, "group": … }, … ]' };

  const seen = new Map<string, number>();
  for (let i = 0; i < data.length; i++) {
    const at = (why: string): Failure => ({ error: `Запись ${i + 1}: ${why}` });
    const r: unknown = data[i];
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return at('ожидается объект');
    const rec = r as Record<string, unknown>;
    if (Object.keys(rec).some((k) => !JSON_KEYS.has(k))) return at('есть лишние поля');
    if (typeof rec.name !== 'string' || rec.name.trim() === '') return at('нет ФИО');
    if (!GROUPS.includes(rec.group as GroupCode)) return at(`группа должна быть одной из ${GROUPS.join(', ')}`);
    for (const key of ['hireDate', 'fireDate'] as const) {
      const v = rec[key];
      if (v !== undefined && v !== null && (typeof v !== 'string' || parseDate(v, '') === '')) return at(`${key}: ожидается дата вида 2026-11-09 или null`);
    }
    if (typeof rec.hireDate === 'string' && typeof rec.fireDate === 'string' && rec.fireDate <= rec.hireDate) return at('увольнение должно быть позже приёма');
    if (rec.baseLevel !== undefined && !LEVELS.includes(rec.baseLevel as Level)) return at(`baseLevel должен быть одним из ${LEVELS.join(', ')}`);
    if (rec.hiddenFromRating !== undefined && typeof rec.hiddenFromRating !== 'boolean') return at('hiddenFromRating: ожидается true или false');
    if (rec.hiddenReason !== undefined && (typeof rec.hiddenReason !== 'string' || rec.hiddenReason.length > HIDDEN_REASON_MAX)) return at('hiddenReason: текст не длиннее 200 знаков');
    if (rec.hiddenFromRating === true && (typeof rec.hiddenReason !== 'string' || rec.hiddenReason.trim() === '')) return at('для исключения из рейтинга нужна причина');

    const key = normalizeName(rec.name);
    const first = seen.get(key);
    if (first !== undefined) return at(`ФИО повторяется (как в записи ${first})`);
    seen.set(key, i + 1);
  }
  return data as StaffItem[];
}

export interface AbsenceForm {
  kind: string;
  from: string;
  to: string;
}

/** Отсутствие для `setAbsence`: `to` пустой — без даты окончания (`null`). */
export function buildAbsence(form: AbsenceForm): { kind: Absence['kind']; from: DateStr; to: DateStr | null } | Failure {
  if (!KINDS.includes(form.kind as Absence['kind'])) return { error: 'Выберите тип отсутствия' };
  const from = readDate(form.from);
  const to = readDate(form.to);
  if (from === null || from === 'bad') return { error: 'Начало: ожидается дата вида 2026-11-09' };
  if (to === 'bad') return { error: 'Конец: ожидается дата вида 2026-11-09 или пусто' };
  if (to !== null && to < from) return { error: 'Конец раньше начала' };
  return { kind: form.kind as Absence['kind'], from, to };
}
