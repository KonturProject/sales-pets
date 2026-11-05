import { ART, GROUP_KEY, THEME } from '@/art/manifest';
import type { PetState } from '@/engine/pet';
import type { GroupCode } from '@/engine/types';
import { MOOD_LABEL } from '@/game/PetView';
import { DECOR } from './art';
import { HOUSE, type RoomRect } from './layout';
import { tickerItems, type FunnelTotal, type TickerItem } from './metrics';

/** Длина анимации руки в `tv.css`; следующая рука в той же комнате ждёт, пока предыдущая уйдёт. */
export const HAND_MS = 1800;
/** Рука убирается сама, даже если `animationend` не придёт (вкладка на паузе, анимации отключены). */
const HAND_SAFETY_MS = 3000;
export const BALL = 38;
/** Дуга перекинутого мяча: подъём (выше самого крупного питомца, 170 px), px и длительность, мс. */
const TOSS_LIFT = 230;
const TOSS_MS = 700;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const img = (cls: string, src: string): HTMLImageElement => {
  const node = new Image();
  node.className = cls;
  node.src = src;
  node.alt = '';
  node.decoding = 'async';
  return node;
};

/**
 * Комната группы в домике: стена с декором, табличка (код, вид, настроение, `.sub`, сытость), табло цифр,
 * кучки с мухами, ящики аптечек и игрушек, мяч, рука РГ. Сам питомец живёт в слое мира (`PetActor`).
 * `el` — `[data-group]` с `data-phase/mood/stage/piles`: на них опираются проверки экрана.
 */
export class RoomView {
  readonly el: HTMLElement;
  /** мяч в координатах комнаты: центр по `x`, угол поворота */
  readonly ball = { x: 330, rot: 0 };
  private readonly ballEl: HTMLElement;
  private shown = '';
  private tossAnims: Animation[] = [];
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly species: HTMLElement;
  private readonly mood: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly sat: HTMLElement;
  private readonly slot: HTMLElement;
  private readonly piles: HTMLElement;
  private readonly medkits: HTMLElement;
  private readonly toys: HTMLElement;
  private items: TickerItem[] = [];
  private tickN = 0;
  private shownItem = '';
  private pilesShown = -1;
  private hands = 0;

  constructor(readonly group: GroupCode, index: number, readonly rect: RoomRect) {
    const theme = THEME[group];
    this.el = el('section', 'tv-room');
    this.el.dataset.group = group;
    this.el.dataset.key = GROUP_KEY[group];
    this.el.style.left = `${rect.x - HOUSE.x}px`;
    this.el.style.top = `${rect.y - HOUSE.y}px`;
    this.el.style.setProperty('--accent', theme.accent);

    const wall = el('div', 'rwall');
    wall.style.background = `linear-gradient(${theme.wall[0]}, ${theme.wall[1]})`;
    const decor = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    decor.setAttribute('class', 'decor');
    decor.setAttribute('viewBox', '0 0 529 340');
    decor.innerHTML = DECOR[theme.decor];
    const floor = el('div', 'rfloor');
    floor.style.background = theme.floor;

    const sign = el('header', 'sign');
    const title = el('div', 'title');
    // вид питомца — сюрприз: до вылупления «???» (update)
    this.species = el('span', 'species', '???');
    title.append(el('b', 'code', group), this.species);
    this.mood = el('span', 'mood');
    this.sub = el('div', 'sub');
    const sat = el('div', 'sat');
    sat.title = 'Сытость: оплаты сегодня к дневной норме';
    this.sat = el('i', '');
    sat.append(this.sat);
    sign.append(title, this.mood, this.sub, sat);

    const ticker = el('div', 'ticker');
    this.slot = el('div', 'slot');
    ticker.append(this.slot);

    this.piles = el('div', 'tv-piles');

    const crate = (kind: 'medkits' | 'toys', icon: string, tip: string) => {
      const count = el('b', '', '0');
      count.dataset.count = kind;
      const wrap = el('div', 'crate');
      wrap.title = tip;
      wrap.append(img('', icon), count);
      return { wrap, count };
    };
    const medkits = crate('medkits', ART.medkit, 'Аптечки: лечат болезнь');
    const toys = crate('toys', ART.toy, 'Игрушки: лечат скуку и грусть');
    this.medkits = medkits.count;
    this.toys = toys.count;
    const inv = el('div', 'inv');
    inv.append(medkits.wrap, toys.wrap);

    this.ballEl = el('div', 'ball');
    this.ball.x = 150 + (index % 3) * 110;
    this.tickN = index; // соседние табло показывают разные цифры, как в макете
    this.placeBall();

    this.el.append(wall, decor, floor, sign, ticker, this.piles, inv, this.ballEl);
  }

  update(s: PetState, funnel?: FunnelTotal): void {
    const d = this.el.dataset;
    d.phase = s.phase;
    d.mood = s.mood;
    d.stage = String(s.stage);
    d.piles = String(s.piles);
    d.alive = String(s.alive);

    this.species.textContent = s.phase === 'pet' ? THEME[this.group].species : '???';
    this.mood.textContent = MOOD_LABEL[s.mood];
    this.sub.textContent = !s.alive ? 'питомец погиб'
      : s.phase === 'pet' ? `стадия ${s.stage} · оплат ${s.totalPayments}`
      : `яйцо · оплат ${s.totalPayments}`;
    this.sat.style.width = `${s.alive ? Math.round(s.satiety * 100) : 0}%`;
    this.medkits.textContent = String(s.medkits);
    this.toys.textContent = String(s.toys);
    this.renderPiles(s.piles);

    this.items = tickerItems(s, funnel);
    this.showTicker(false);
  }

  /** Следующая цифра табло (зовёт экран раз в несколько секунд). */
  nextTicker(): void {
    this.tickN++;
    this.showTicker(true);
  }

  /**
   * Поставить мяч в `ball`; `toss` — мяч перекинут через питомца: он взлетает над его головой и садится по другую
   * сторону (при reduced motion без дуги, обычным переходом). В броске сдвиг и подъём идут по одной шкале 700 мс:
   * подъём быстрый (ease-out), сдвиг медленный сначала (ease-in), так что над питомцем мяч уже в верхней точке.
   */
  placeBall(toss = false): void {
    const to = `translate(${this.ball.x - BALL / 2}px, 0) rotate(${this.ball.rot}deg)`;
    const from = this.shown;
    this.shown = to;
    this.tossAnims.forEach((a) => a.cancel());
    this.tossAnims = [];
    if (toss && !this.reduced && this.ballEl.animate) {
      const opts = { duration: TOSS_MS } as const;
      this.ballEl.style.transition = 'none';
      this.tossAnims = [
        this.ballEl.animate([{ transform: from }, { transform: to }], { ...opts, easing: 'ease-in' }),
        this.ballEl.animate(
          [
            { translate: '0 0', easing: 'cubic-bezier(.1, .7, .3, 1)' },
            { translate: `0 -${TOSS_LIFT}px`, offset: 0.5, easing: 'cubic-bezier(.7, 0, .9, .3)' },
            { translate: '0 0' },
          ],
          opts,
        ),
      ];
      this.tossAnims[0]!.onfinish = () => (this.ballEl.style.transition = '');
    } else {
      this.ballEl.style.transition = '';
    }
    this.ballEl.style.transform = to;
  }

  /** Рука с предметом над питомцем (R20): на состояние не влияет и убирается сама. `x` — в координатах комнаты. */
  playHand(item: 'medkit' | 'toy', x: number): void {
    const hand = el('div', 'hand');
    hand.dataset.item = item;
    hand.append(img('', item === 'medkit' ? ART.medkit : ART.toy));
    const wait = this.hands * HAND_MS;
    hand.style.setProperty('--hand-delay', `${wait}ms`);
    hand.style.left = `${Math.max(40, Math.min(this.rect.w - 110, x))}px`;
    this.el.append(hand);
    this.hands++;
    const remove = () => {
      if (!hand.isConnected) return;
      clearTimeout(timer);
      hand.remove();
      this.hands--;
    };
    const timer = setTimeout(remove, wait + HAND_SAFETY_MS);
    hand.addEventListener('animationend', remove);
  }

  /** Табло меняется только при новой цифре: анимация въезда не повторяется на каждом обновлении данных. */
  private showTicker(animate: boolean): void {
    const item = this.items[this.tickN % this.items.length];
    if (!item) return;
    const key = `${item.label}|${item.value}|${item.unit ?? ''}`;
    if (key === this.shownItem) return;
    this.shownItem = key;
    const slide = el('div', animate ? 'slide' : '');
    const value = el('div', 'tval', item.value);
    if (item.unit) value.append(el('small', '', ` ${item.unit}`));
    slide.append(el('div', 'tl', item.label), value);
    this.slot.replaceChildren(slide);
  }

  /** Кучки перестраиваются только при изменении числа; мухи существуют лишь пока есть кучки. */
  private renderPiles(n: number): void {
    if (n === this.pilesShown) return;
    this.pilesShown = n;
    this.piles.replaceChildren(...Array.from({ length: n }, () => img('pile', ART.pile)));
    if (n > 0) this.piles.append(img('flies', ART.flies));
  }
}
