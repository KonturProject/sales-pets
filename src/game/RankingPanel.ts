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

const short = (d: DateStr) => `${d.slice(8)}.${d.slice(5, 7)}`;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

interface Block {
  el: HTMLElement;
  rows: HTMLTableSectionElement;
  select?: HTMLSelectElement;
}

/** Блок панели: заголовок (+ выбор), таблица «место, сотрудник, [группа], значение». */
function block(name: string, title: string, valueTitle: string, withGroup: boolean, pick?: string): Block {
  const el = node('section', 'rank-block');
  el.dataset.block = name;
  const head = node('header', 'rank-head');
  head.append(node('h2', undefined, title));
  let select: HTMLSelectElement | undefined;
  if (pick) {
    select = node('select');
    select.dataset.pick = pick;
    head.append(select);
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
  return { el, rows, select };
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
 * Три блока рейтингов: «Группа» (накопительно с начала игры, выбор группы), «Топ-10» (все группы) и «Герои дня»
 * (выбранный рабочий день); раскладывает их по экрану вызывающий. `update()` вызывают каждый тик: DOM
 * перерисовывается, только если сменились данные или дата, поэтому выбор в списках не сбрасывается.
 * `pickGroup` — выбор группы без пользователя (листание на стене).
 */
export function mountRanking(
  get: () => RankData,
  opts: { asOf: () => DateStr },
): { blocks: Record<BlockName, HTMLElement>; update(): void; pickGroup(g: GroupCode): void } {
  const groupBlock = block('group', 'Группа', 'Оплат', false, 'group');
  const topBlock = block('top', 'Топ-10', 'Оплат', true);
  const heroesBlock = block('heroes', 'Герои дня', 'Норма', true, 'day');
  groupBlock.select!.append(...GROUPS.map((g) => new Option(g, g)));

  let group: GroupCode = GROUPS[0];
  let pickedDay: DateStr | null = null; // выбор пользователя; null — день по умолчанию
  let shown: { data: RankData; asOf: DateStr } | null = null;
  let dayOptions = '';

  const renderGroup = ({ data, asOf }: NonNullable<typeof shown>) =>
    fill(groupBlock, groupRanking(group, data.cfg.startDate, asOf, data), false, String);

  const renderHeroes = ({ data, asOf }: NonNullable<typeof shown>) => {
    const { days, initial } = heroDays(asOf, data.cfg);
    const day = pickedDay !== null && days.includes(pickedDay) ? pickedDay : initial;
    const select = heroesBlock.select!;
    if (days.join() !== dayOptions) {
      dayOptions = days.join();
      select.replaceChildren(...days.map((d) => new Option(short(d), d)));
    }
    select.value = day ?? '';
    heroesBlock.el.dataset.day = day ?? '';
    fill(heroesBlock, day ? heroesOfDay(day, data) : [], true, (v) => `${v}%`);
  };

  groupBlock.select!.addEventListener('change', () => {
    group = groupBlock.select!.value as GroupCode;
    if (shown) renderGroup(shown);
  });
  heroesBlock.select!.addEventListener('change', () => {
    pickedDay = heroesBlock.select!.value;
    if (shown) renderHeroes(shown);
  });

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
    groupBlock.select!.value = g;
    if (shown) renderGroup(shown);
  };
  update();
  return { blocks: { group: groupBlock.el, top: topBlock.el, heroes: heroesBlock.el }, update, pickGroup };
}
