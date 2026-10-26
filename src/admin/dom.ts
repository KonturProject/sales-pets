import { ApiError } from '@/data/api';

type Attr = string | number | boolean | undefined | ((e: Event) => void);
type Child = Node | string | false | null | undefined;

/** Элемент без innerHTML: текст всегда уходит как текстовый узел; функции в атрибутах — обработчики событий. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, Attr> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') el.addEventListener(key.replace(/^on/, ''), value);
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false && value !== undefined) el.setAttribute(key, String(value));
  }
  for (const child of children) if (child !== false && child !== null && child !== undefined) el.append(child);
  return el;
}

export interface TabItem {
  id: string;
  title: string;
  /** Вызывается при каждом открытии вкладки: форма всегда строится заново и не хранит прошлых значений. */
  render: () => HTMLElement | Promise<HTMLElement>;
}

export function tabs(items: TabItem[]): HTMLElement {
  const panel = h('div', { role: 'tabpanel' });
  const buttons = items.map((item) =>
    h('button', { type: 'button', role: 'tab', 'data-tab': item.id, 'aria-selected': false, onclick: () => void select(item) }, item.title),
  );
  let current = 0;
  async function select(item: TabItem): Promise<void> {
    const mine = ++current;
    buttons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === item.id)));
    panel.dataset.tab = item.id;
    panel.replaceChildren('Загрузка…');
    let content: HTMLElement;
    try {
      content = await item.render();
    } catch (e) {
      content = h('p', { role: 'alert' }, errorText(e));
    }
    if (mine === current) panel.replaceChildren(content);
  }
  const nav = h('nav', { role: 'tablist' }, ...buttons);
  void select(items[0]);
  return h('div', { class: 'tabs' }, nav, panel);
}

/** Человеческий текст ошибки; коды сервера пользователю не показываются. */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Ошибка сервера, повторите позже';
  switch (e.code) {
    case 'invalid_pin':
      return 'Неверный PIN';
    case 'locked':
      return `Заблокировано после неверных попыток. Подождите ${Math.max(1, Math.ceil((e.retryAfterSec ?? 60) / 60))} мин.`;
    case 'network':
      return 'Нет связи с сервером';
    case 'bad_request':
      return 'Сервер отклонил запрос: проверьте введённые значения';
    default:
      return 'Ошибка сервера, повторите позже';
  }
}
