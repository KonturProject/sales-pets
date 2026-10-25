import { ART, GROUP_KEY } from '@/art/manifest';
import type { Mood, PetState } from '@/engine/pet';
import type { GroupCode } from '@/engine/types';

const MOOD_LABEL: Record<Mood, string> = { ok: '', bored: 'скучает', sad: 'грустит', sick: 'болеет', dead: 'погиб' };
const MAX_STAGE = 15;

/** Размер питомца: от 0.55 при вылуплении до 1 на последней стадии (пока одна картинка на группу). */
export function petScale(stage: number): number {
  return 0.55 + 0.45 * Math.min(Math.max(stage, 0), MAX_STAGE) / MAX_STAGE;
}

function spriteFor(group: GroupCode, s: PetState): { src: string; scale: number } {
  if (!s.alive) return { src: ART.grave, scale: 0.7 };
  if (s.phase === 'pet') {
    const list = ART.pets[group];
    return { src: list[Math.min(s.stage, list.length - 1)], scale: petScale(s.stage) };
  }
  return { src: ART.eggs[group][Number(s.phase.slice(3))], scale: 0.62 };
}

const img = (cls: string, src: string): HTMLImageElement => {
  const el = new Image();
  el.className = cls;
  el.src = src;
  el.alt = '';
  el.decoding = 'async';
  return el;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Гнездо одной группы: питомец/яйцо/надгробие, кучки с мухами, сытость, ящики с аптечками и игрушками. */
export class PetView {
  readonly el: HTMLElement;
  private readonly sprite: HTMLImageElement;
  private readonly creature: HTMLElement;
  private readonly piles: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly medkits: HTMLElement;
  private readonly toys: HTMLElement;
  private pilesShown = -1;

  constructor(readonly group: GroupCode) {
    this.el = el('section', 'spot');
    this.el.dataset.group = group;
    this.el.dataset.key = GROUP_KEY[group];

    const head = el('header', 'head');
    this.sub = el('span', 'sub');
    head.append(el('h2', 'label', group), this.sub);

    const stage = el('div', 'stage');
    this.sprite = img('sprite', ART.grave);
    this.creature = el('div', 'creature');
    this.creature.append(this.sprite);
    this.piles = el('div', 'piles');
    this.badge = el('span', 'badge');
    stage.append(img('nest', ART.nest), this.creature, this.piles, this.badge);

    this.meter = el('i', '');
    const meter = el('div', 'meter');
    meter.title = 'Сытость: оплаты сегодня к дневной норме';
    meter.append(this.meter);

    const box = (kind: 'medkits' | 'toys', icon: string, title: string) => {
      const count = el('b', '', '0');
      count.dataset.count = kind;
      const wrap = el('div', 'box');
      wrap.title = title;
      wrap.append(img('', icon), count);
      return { wrap, count };
    };
    const medkits = box('medkits', ART.medkit, 'Аптечки: лечат болезнь');
    const toys = box('toys', ART.toy, 'Игрушки: лечат скуку и грусть');
    this.medkits = medkits.count;
    this.toys = toys.count;
    const boxes = el('div', 'boxes');
    boxes.append(medkits.wrap, toys.wrap);

    this.el.append(head, stage, meter, boxes);
  }

  update(s: PetState): void {
    const d = this.el.dataset;
    d.phase = s.phase;
    d.mood = s.mood;
    d.stage = String(s.stage);
    d.piles = String(s.piles);

    const { src, scale } = spriteFor(this.group, s);
    if (this.sprite.getAttribute('src') !== src) this.sprite.src = src;
    this.creature.style.setProperty('--scale', String(scale));

    this.sub.textContent = !s.alive ? 'питомец погиб'
      : s.phase === 'pet' ? `стадия ${s.stage} · оплат ${s.totalPayments}`
      : `яйцо · оплат ${s.totalPayments}`;
    this.badge.textContent = MOOD_LABEL[s.mood];
    this.meter.style.width = `${Math.round(s.satiety * 100)}%`;
    this.medkits.textContent = String(s.medkits);
    this.toys.textContent = String(s.toys);
    this.renderPiles(s.piles);
  }

  /** Кучки перестраиваются только при изменении числа; мухи существуют лишь пока есть кучки. */
  private renderPiles(n: number): void {
    if (n === this.pilesShown) return;
    this.pilesShown = n;
    this.piles.replaceChildren(...Array.from({ length: n }, () => img('pile', ART.pile)));
    if (n > 0) this.piles.append(img('flies', ART.flies));
  }
}
