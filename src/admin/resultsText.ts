import { ruNum } from '@/engine/format';
import type { DateStr, Level } from '@/engine/types';
import type { Cell, CorrectionView, EmployeeLine, GroupLine, Kind, Outcome } from './results';

/** Чистые тексты вкладки «Итоги»: что написать в ячейке, итоге дня, подписях и списке правок. DOM здесь не нужен. */

/** Показатель в середине фразы: «длинные: правка +1 …». */
export const KIND_WORD: Record<Kind, string> = { quality: 'качественные', long: 'длинные', payments: 'оплаты' };
export const LEVEL_TITLE: Record<Level, string> = { experienced: 'опытный', rookie1: 'новичок 1', rookie2: 'новичок 2' };
export const ABSENT_FUNNEL_NOTE = 'сотрудник отсутствует: его воронка не входит в итог группы, поправить её нельзя';

/** Число с запятой и типографским минусом. */
export const num = (n: number): string => (n < 0 ? `−${ruNum(-n)}` : ruNum(n));
/** Со знаком: «+1», «−2». */
export const signed = (n: number): string => (n > 0 ? `+${ruNum(n)}` : n < 0 ? `−${ruNum(-n)}` : '0');
/** `2026-11-03` → `03.11`. */
export const shortDate = (d: DateStr): string => `${d.slice(8)}.${d.slice(5, 7)}`;

const WEEKDAY = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
/** Подпись дня в списке: «11.11, ср» или «07.11, сб — выходной». */
export function dayLabel(day: { date: DateStr; working: boolean }): string {
  const weekday = WEEKDAY[new Date(`${day.date}T00:00:00Z`).getUTCDay()];
  return `${shortDate(day.date)}, ${weekday}${day.working ? '' : ' — выходной'}`;
}

export interface CellText {
  /** «факт / план», плана нет — «—» */
  text: string;
  /** ✓ — факт не меньше плана, ✗ — меньше, null — плана нет */
  verdict: 'ok' | 'bad' | null;
  /** «из них 2 в выходные» (оплаты рабочего дня) */
  weekend: string | null;
  /** «правки +1» */
  corrected: string | null;
  stale: boolean;
}

export function cellText(c: Cell): CellText {
  // сравнение в сотых, как в оценке дня: 10,5 не должно ломаться от 0,1 + 0,2
  const verdict = c.plan === null ? null : Math.round(c.fact * 100) >= Math.round(c.plan * 100) ? 'ok' : 'bad';
  return {
    text: `${num(c.fact)} / ${c.plan === null ? '—' : ruNum(c.plan)}`,
    verdict,
    weekend: c.weekend ? `из них ${c.weekend} в выходные` : null,
    corrected: c.corrected !== 0 ? `правки ${signed(c.corrected)}` : null,
    stale: c.stale,
  };
}

/** Итог дня строками: длинные (аптечка и кучка), качественные (игрушка), с причиной. Не оценивается день — одна строка. */
export function outcomeLines(o: Outcome): string[] {
  if (!o.evaluated) return [o.reason === 'weekend' ? 'выходной' : 'воронка за день не загружена'];
  const r = o.result;
  const long = `длинные ${ruNum(r.factLong)} из ${ruNum(r.normLong)}`;
  const quality = `качественные ${ruNum(r.factQuality)} из ${ruNum(r.normQuality)}`;
  const lines = [
    !r.longRequired ? 'длинные: нормы нет' : r.longMet ? `Аптечка, −1 кучка (${long})` : `+1 кучка (${long})`,
    r.qualityMet ? `игрушка (${quality})` : r.normQuality > 0 ? `нет игрушки (${quality})` : 'нет игрушки (качественные: нормы нет)',
  ];
  if (o.appliesOn) lines.push(`с ${shortDate(o.appliesOn)}`);
  return lines;
}

/** «Сейчас» питомца группы: стадия, запасы, настроение с причиной. */
export function nowLines(line: Pick<GroupLine, 'now' | 'nowReason'>): string[] {
  const { now, nowReason } = line;
  const lines = [
    !now.alive ? 'погиб' : now.phase === 'pet' ? `стадия ${now.stage}` : 'яйцо',
    `кучек ${now.piles} · аптечек ${now.medkits} · игрушек ${now.toys}`,
  ];
  if (nowReason === null) lines.push('настроение в порядке');
  else if (now.alive) lines.push(nowReason);
  return lines;
}

/** Отметки у сотрудника: отсутствие, «не в рейтинге», «не входит в итог группы». */
export function employeeMarks(e: Pick<EmployeeLine, 'absence' | 'hidden' | 'inGroupTotal'>): string[] {
  const marks: string[] = [];
  if (e.absence) marks.push(e.absence === 'vacation' ? 'отпуск' : e.absence === 'sick' ? 'больничный' : 'отсутствует');
  if (e.hidden) marks.push('не в рейтинге');
  if (!e.inGroupTotal) marks.push('не входит в итог группы');
  return marks;
}

/** Подпись под полем редактора: «из файла 3» или «из файла 3, правки +1». */
export const editorCaption = (file: number, corrections: number): string =>
  `из файла ${ruNum(file)}${corrections !== 0 ? `, правки ${signed(corrections)}` : ''}`;

/** Строки «не разнесено по сотрудникам: N» и «из них авторы не из штата: K» под сотрудниками группы. */
export function unassignedLines(u: GroupLine['unassigned']): string[] {
  const lines: string[] = [];
  if (u.payments !== 0) lines.push(`не разнесено по сотрудникам: ${num(u.payments)}`);
  if (u.unmatched > 0) lines.push(`из них авторы не из штата: ${u.unmatched}`);
  return lines;
}

/** Про устаревшую правку (в файле теперь не то, что админ видел). Пусто, если правка не устарела. */
export function staleText(v: Pick<CorrectionView, 'c' | 'fileNow' | 'stale'>): string {
  if (!v.stale || v.fileNow === null) return '';
  return `правка ${signed(v.c.delta)} сделана при ${v.c.base} в файле, теперь в файле ${v.fileNow} — проверьте, не пришёл ли счёт сам`;
}

type CorrectionLike = Pick<CorrectionView, 'c' | 'group' | 'name' | 'fileNow' | 'stale'>;

/** «03.11, СР3, Иванов И., длинные: » — начало строки про правку; группа на дату правки, «—», если сотрудника нет в штате. */
const correctionHead = (v: CorrectionLike): string => `${shortDate(v.c.date)}, ${v.group ?? '—'}, ${v.name}, ${KIND_WORD[v.c.kind]}: `;

/** Устаревшая правка в разборе загрузки: «03.11, СР3, Иванов И., длинные: правка +1 сделана при 2 в файле, теперь в файле 3 — …». */
export const staleLine = (v: CorrectionLike): string => `${correctionHead(v)}${staleText(v)}`;

/** Правка в списке разбора: «03.11, СР3, Иванов И., оплаты: +1», у устаревшей добавлено, что изменилось. */
export const correctionLine = (v: CorrectionLike): string =>
  `${correctionHead(v)}${signed(v.c.delta)}${v.stale ? ` — ⚠ ${staleText(v)}` : ''}`;
