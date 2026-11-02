import './ranking.css';
import { THEME } from '@/art/manifest';
import { workingDaysBetween } from '@/engine/calendar';
import type { Config } from '@/engine/config';
import { groupRanking, heroesOfDay, topOverall, type RankData, type RankRow } from '@/engine/ranking';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';

/** Рабочие дни до `asOf` включительно для выбора дня героев; по умолчанию — предыдущий рабочий день (R8). */
export function heroDays(asOf: DateStr, cfg: Config): { days: DateStr[]; initial: DateStr | null } {
  const days = workingDaysBetween(cfg.startDate, asOf, cfg);
  const before = days.filter((d) => d < asOf);
  return { days, initial: before.length ? before[before.length - 1] : null };
}

/** Соседний день героев для стрелок: в пределах `days`; если `current` нет в списке — последний день. */
export function stepDay(days: readonly DateStr[], current: DateStr | null, delta: number): DateStr | null {
  if (!days.length) return null;
  const i = current === null ? -1 : days.indexOf(current);
  if (i < 0) return days[days.length - 1];
  return days[Math.min(Math.max(i + delta, 0), days.length - 1)];
}

export const short = (d: DateStr) => `${d.slice(8)}.${d.slice(5, 7)}`;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

interface Block {
  el: HTMLElement;
  rows: HTMLTableSectionElement;
  /** плашка выбранного (группа или день) в заголовке: выбирают на нижней панели экрана */
  pick?: HTMLElement;
}

/** Блок панели: заголовок (+ плашка выбранного), таблица «место, сотрудник, [группа], значение». */
function block(name: string, title: string, valueTitle: string, withGroup: boolean, pick?: string): Block {
  const el = node('section', 'rank-block');
  el.dataset.block = name;
  const head = node('header', 'rank-head');
  head.append(node('h2', undefined, title));
  let chip: HTMLElement | undefined;
  if (pick) {
    chip = node('span', 'rank-pick');
    chip.dataset.pick = pick;
    head.append(chip);
  }
  const titles = ['Место', 'Сотрудник', ...(withGroup ? ['Группа'] : []), valueTitle];
  const headRow = node('tr');
  headRow.append(...titles.map((t) => node('th', undefined, t)));
  const thead = node('thead');
  thead.append(headRow);
  const rows = node('tbody');
  const table = node('table');
  table.append(thead, rows);
  el.append(head, table);
  return { el, rows, pick: chip };
}

function fill(b: Block, rows: RankRow[], withGroup: boolean, format: (v: number) => string): void {
  if (!rows.length) {
    const td = node('td', 'empty', 'Пока никого');
    td.colSpan = withGroup ? 4 : 3;
    const tr = node('tr');
    tr.append(td);
    b.rows.replaceChildren(tr);
    return;
  }
  b.rows.replaceChildren(...rows.map((r) => {
    const tr = node('tr');
    tr.dataset.employee = r.employeeId;
    const who = node('td', 'who');
    who.append(node('span', 'name', r.name));
    if (r.facts) {
      const f = r.facts;
      who.append(node('span', 'facts', `кач ${f.quality}/${f.normQuality} · длин ${f.long}/${f.normLong}`));
    }
    tr.append(node('td', 'place', String(r.place)), who);
    if (withGroup) {
      const grp = node('td', 'grp');
      const chip = node('span', 'chip', r.group);
      chip.style.background = THEME[r.group]?.accent ?? '';
      grp.append(chip);
      tr.append(grp);
    }
    tr.append(node('td', 'value', format(r.value)));
    return tr;
  }));
}

export type BlockName = 'group' | 'top' | 'heroes';

/**
 * Три блока рейтингов: «Группа» (накопительно с начала игры), «Топ-10» (все группы) и «Герои дня»
 * (выбранный рабочий день); раскладывает их по экрану вызывающий. `update()` вызывают каждый тик: DOM
 * перерисовывается, только если сменились данные или дата, поэтому выбор не сбрасывается.
 * Выбор приходит снаружи (нижняя панель, листание на стене): `pickGroup`, `stepDay`, `resetDay` (снова день по умолчанию);
 * `picked()` — что показано.
 */
export function mountRanking(
  get: () => RankData,
  opts: { asOf: () => DateStr },
): {
  blocks: Record<BlockName, HTMLElement>;
  update(): void;
  pickGroup(g: GroupCode): void;
  stepDay(delta: number): void;
  resetDay(): void;
  picked(): { group: GroupCode; day: DateStr | null; days: readonly DateStr[] };
} {
  const groupBlock = block('group', 'Группа', 'Оплат', false, 'group');
  const topBlock = block('top', 'Топ-10', 'Оплат', true);
  const heroesBlock = block('heroes', 'Герои дня', 'Норма', true, 'day');

  let group: GroupCode = GROUPS[0];
  let pickedDay: DateStr | null = null; // выбор пользователя; null — день по умолчанию
  let shown: { data: RankData; asOf: DateStr } | null = null;
  let day: DateStr | null = null;
  let days: DateStr[] = [];

  const renderGroup = ({ data, asOf }: NonNullable<typeof shown>) => {
    groupBlock.el.dataset.shown = group;
    groupBlock.pick!.textContent = group;
    groupBlock.pick!.style.setProperty('--accent', THEME[group].accent);
    fill(groupBlock, groupRanking(group, data.cfg.startDate, asOf, data), false, String);
  };

  const renderHeroes = ({ data, asOf }: NonNullable<typeof shown>) => {
    const hd = heroDays(asOf, data.cfg);
    days = hd.days;
    day = pickedDay !== null && days.includes(pickedDay) ? pickedDay : hd.initial;
    heroesBlock.pick!.textContent = day ? short(day) : '—';
    heroesBlock.el.dataset.day = day ?? '';
    fill(heroesBlock, day ? heroesOfDay(day, data) : [], true, (v) => `${v}%`);
  };

  const update = () => {
    const data = get();
    const asOf = opts.asOf();
    if (shown && shown.data === data && shown.asOf === asOf) return;
    shown = { data, asOf };
    renderGroup(shown);
    fill(topBlock, topOverall(data.cfg.startDate, asOf, data), true, String);
    renderHeroes(shown);
  };
  const pickGroup = (g: GroupCode) => {
    if (g === group) return;
    group = g;
    if (shown) renderGroup(shown);
  };
  const step = (delta: number) => {
    pickedDay = stepDay(days, day, delta);
    if (shown) renderHeroes(shown);
  };
  const resetDay = () => {
    if (pickedDay === null) return;
    pickedDay = null;
    if (shown) renderHeroes(shown);
  };
  update();
  return {
    blocks: { group: groupBlock.el, top: topBlock.el, heroes: heroesBlock.el },
    update,
    pickGroup,
    stepDay: step,
    resetDay,
    picked: () => ({ group, day, days }),
  };
}
