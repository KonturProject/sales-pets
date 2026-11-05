import { ART, GROUP_KEY, THEME } from '@/art/manifest';
import type { PetState } from '@/engine/pet';
import type { GroupCode } from '@/engine/types';
import { MOOD_LABEL } from '@/game/PetView';
import { DECOR } from './art';
import { HOUSE, type RoomRect } from './layout';
import { tickerItems, type FunnelTotal, type TickerItem } from './metrics';
import { TOYS, type ToyKind, type ToyPlay } from './toys';

/** Длина анимации руки в `tv.css`; следующая рука в той же комнате ждёт, пока предыдущая уйдёт. */
export const HAND_MS = 1800;
/** Рука убирается сама, даже если `animationend` не придёт (вкладка на паузе, анимации отключены). */
const HAND_SAFETY_MS = 3000;
export const BALL = 38;
/** Дуга перекинутого мяча: подъём (выше самого крупного питомца, 170 px), px и длительность, мс. */
const TOSS_LIFT = 230;
const TOSS_MS = 700;

/** Игрушка дня: сторона рамки картинки, px комнаты (как `.toy` в `tv.css`). */
const TOY = 56;
/** Подскок: [мс полёта, высота px]. */
type Hop = readonly [number, number];
/** Падение игрушки после руки: с высоты (над комнатой) до касания пола за `TOY_LAND_MS`, потом два отскока. */
const DROP_FROM = 420;
export const TOY_LAND_MS = 520;
const DROP_HOPS: readonly Hop[] = [[300, 44], [180, 12]];
/** После последнего касания игрушка выпрямляется столько. */
const SETTLE_MS = 160;
const DROP_MS = TOY_LAND_MS + DROP_HOPS.reduce((s, [ms]) => s + ms, 0) + SETTLE_MS;
/** Уточка от пинка скачет тремя затухающими прыжками; приземление после броска — маленький отскок. */
const DUCK_HOPS: readonly Hop[] = [[320, 50], [230, 20], [140, 6]];
const TOSS_HOPS: readonly Hop[] = [[200, 14]];
/** Юла крутится (класс `spin`), мишку обнимают: длительности, мс (питомец ждёт их в `PetActor`). */
export const SPIN_MS = 1500;
export const HUG_MS = 1400;
/** Вверх — замедляясь, вниз — разгоняясь (как под тяжестью); качение — как переход мяча в `tv.css`. */
const RISE = 'cubic-bezier(.5, 1, .89, 1)';
const FALL = 'cubic-bezier(.11, 0, .5, 0)';
const ROLL = 'cubic-bezier(.2, .7, .3, 1)';
const STRETCH = '.9 1.1';
/** Сплющивание при касании: сильнее с большой высоты. */
const squash = (h: number) => {
  const q = Math.min(0.3, 0.045 * Math.sqrt(h));
  return `${1 + q} ${1 - q}`;
};
/** Крутятся только катящиеся: кубик ложится на грань (кратно 90°), ёжик катится как мяч; остальные стоят ровно. */
const toyTurn = (kind: ToyKind, rot: number) => (kind === 'cube' ? Math.round(rot / 90) * 90 : kind === 'hedgehog' ? rot : 0);

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
  /** игрушка дня вместо мяча: рамка `toyEl` едет по полу, в ней тень и тело (прыжки, сплющивание) с картинкой (качение) */
  private toyKind: ToyKind | null = null;
  private readonly toyEl: HTMLElement;
  private readonly toyShadow: HTMLElement;
  private readonly toyBody: HTMLElement;
  private toyAnims: Animation[] = [];
  private toyX = 0;
  private toyRot = 0;
  /** до этого момента игрушка ещё в руке или падает: питомец её не трогает */
  private landAt = 0;
  private spinTimer: ReturnType<typeof setTimeout> | undefined;
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
    this.toyEl = el('div', 'toy');
    this.toyShadow = el('i', 'toy-shadow');
    this.toyBody = el('div', 'toy-body');
    this.toyEl.append(this.toyShadow, this.toyBody);

    this.el.append(wall, decor, floor, sign, ticker, this.piles, inv, this.ballEl, this.toyEl);
  }

  /** Во что играет питомец: мяч или игра игрушки дня; `null` — игрушка ещё в руке или падает. */
  get play(): ToyPlay | 'ball' | null {
    if (!this.toyKind) return 'ball';
    if (performance.now() < this.landAt) return null;
    return TOYS.find((t) => t.kind === this.toyKind)!.play;
  }

  /**
   * Игрушка дня вместо мяча (`null` — снова мяч): стоит в `ball.x`, у `[data-group]` — `data-toy`, мяч скрыт.
   * Тот же вид без `drop` ничего не меняет (зовётся на каждом обновлении). `drop` — игрушку несёт рука РГ: после руки
   * (`HAND_MS`) она падает сверху и дважды отскакивает, а мяч на её месте сжимается и исчезает к касанию; при reduced
   * motion — сразу на месте.
   */
  setToy(kind: ToyKind | null, drop: boolean): void {
    if (kind === this.toyKind && !drop) return;
    const ballShown = !this.toyKind;
    this.stopToy();
    this.toyEl.classList.remove('spin');
    this.toyKind = kind;
    this.landAt = 0;
    if (!kind) {
      delete this.el.dataset.toy;
      return;
    }
    this.el.dataset.toy = kind;
    // новая картинка: без поворота и разворота прежней игрушки; рамка встаёт на место мяча без перехода
    this.toyRot = toyTurn(kind, this.ball.rot);
    const pic = img('', ART.toys[kind]);
    pic.style.rotate = `${this.toyRot}deg`;
    this.toyBody.replaceChildren(pic);
    this.toyX = this.ball.x;
    this.toyEl.style.transition = '';
    this.toyEl.style.transform = `translate(${this.ball.x - TOY / 2}px, 0)`;
    if (!drop || this.reduced || !this.toyBody.animate) return;
    this.landAt = performance.now() + HAND_MS + DROP_MS;
    this.toyAnims = this.bounce(DROP_FROM, TOY_LAND_MS, DROP_HOPS, HAND_MS);
    // в падении игрушка чуть кувыркается и выравнивается к первому отскоку
    const tilt = (rotate: string, offset: number) => ({ rotate, offset, easing: 'ease-in-out' });
    this.toyAnims.push(this.toyBody.animate(
      [tilt('-14deg', 0), tilt('5deg', TOY_LAND_MS / DROP_MS), tilt('0deg', (TOY_LAND_MS + DROP_HOPS[0]![0]) / DROP_MS), tilt('0deg', 1)],
      { duration: DROP_MS, delay: HAND_MS, fill: 'backwards' },
    ));
    if (ballShown) {
      const pop = (s: number) => ({ visibility: 'visible', transform: `${this.shown} scale(${s})` });
      this.toyAnims.push(this.ballEl.animate(
        [pop(1), { ...pop(1.2), offset: 0.45 }, pop(0)],
        { duration: 240, delay: HAND_MS + TOY_LAND_MS - 240, fill: 'backwards', easing: 'ease-in' },
      ));
    }
  }

  /** Юла крутится на месте (класс `spin`, `SPIN_MS`); при reduced motion стоит. */
  spinToy(): void {
    if (this.reduced || performance.now() < this.landAt) return; // новая игрушка ещё падает
    this.toyEl.classList.add('spin');
    clearTimeout(this.spinTimer);
    this.spinTimer = setTimeout(() => this.toyEl.classList.remove('spin'), SPIN_MS);
  }

  /** Мишку обнимают: он дважды сжимается в такт объятиям питомца (`HUG_MS`). */
  hugToy(): void {
    if (this.reduced || !this.toyBody.animate || performance.now() < this.landAt) return;
    this.stopToy();
    const k = (scale: string, offset: number) => ({ scale, offset, easing: 'ease-in-out' });
    this.toyAnims = [this.toyBody.animate(
      [k('1 1', 0), k('1.17 .83', 0.3), k('.96 1.05', 0.45), k('1.17 .83', 0.65), k('.98 1.03', 0.82), k('1 1', 1)],
      HUG_MS,
    )];
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
    if (this.toyKind) {
      // играют игрушкой: скрытый мяч молча переезжает следом, чтобы завтра появиться там, где она лежала
      this.ballEl.style.transform = to;
      this.placeToy(toss);
      return;
    }
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

  /**
   * Пинок игрушки в `ball` (стенки и бросок — как у мяча): рамка едет по полу переходом `tv.css` или дугой броска.
   * От пинка игрушка сплющивается; уточка скачет, глядя, куда летит; кубик кувыркается с грани на грань (на каждой
   * четверти оборота центр приподнимается на ребре); после броска — касание со сплющиванием и маленький отскок.
   */
  private placeToy(toss: boolean): void {
    const kind = this.toyKind!;
    const pic = this.toyBody.firstElementChild as HTMLElement;
    const to = `translate(${this.ball.x - TOY / 2}px, 0)`;
    const from = this.toyEl.style.transform || to;
    const dx = this.ball.x - this.toyX;
    this.toyX = this.ball.x;
    const rot = toyTurn(kind, this.ball.rot);
    const quarters = Math.round(Math.abs(rot - this.toyRot) / 90);
    this.toyRot = rot;
    pic.style.rotate = `${rot}deg`;
    if (kind === 'duck' && dx) pic.style.scale = dx > 0 ? '-1 1' : ''; // на картинке уточка смотрит влево
    this.stopToy();
    const animate = !this.reduced && !!this.toyEl.animate;
    if (toss && animate) {
      const opts = { duration: TOSS_MS } as const;
      this.toyEl.style.transition = 'none';
      this.toyAnims = [
        this.toyEl.animate([{ transform: from }, { transform: to }], { ...opts, easing: 'ease-in' }),
        this.toyBody.animate(
          [
            { translate: '0 0', easing: 'cubic-bezier(.1, .7, .3, 1)' },
            { translate: `0 -${TOSS_LIFT}px`, offset: 0.5, easing: 'cubic-bezier(.7, 0, .9, .3)' },
            { translate: '0 0' },
          ],
          opts,
        ),
        this.toyShadow.animate([{ scale: '1', opacity: '1' }, { scale: '.5', opacity: '.3', offset: 0.5 }, { scale: '1', opacity: '1' }], opts),
        ...this.bounce(TOSS_LIFT, 0, TOSS_HOPS, TOSS_MS),
      ];
      this.toyAnims[0]!.onfinish = () => (this.toyEl.style.transition = '');
    } else {
      this.toyEl.style.transition = '';
    }
    this.toyEl.style.transform = to;
    if (!animate || toss) return;
    if (kind === 'duck') this.toyAnims = this.bounce(20, 0, DUCK_HOPS);
    else {
      this.toyAnims = this.bounce(16, 0, []);
      if (kind === 'cube' && quarters) this.toyAnims.push(this.tumble(quarters));
    }
  }

  /**
   * Подскоки тела игрушки: падение с `from` px за `fall` мс (при `fall = 0` игрушка уже на полу, а `from` — высота,
   * с которой пришёл удар: от неё сплющивание в начале), затем прыжки `hops`. Вверх — замедляясь, вниз — разгоняясь;
   * у пола сплющивается, в полёте вытянута; тень в воздухе меньше и бледнее.
   */
  private bounce(from: number, fall: number, hops: readonly Hop[], delay = 0): Animation[] {
    const total = fall + hops.reduce((s, [ms]) => s + ms, 0) + SETTLE_MS;
    const at = (ms: number) => Math.min(1, Math.max(0, ms / total));
    const path: Keyframe[] = [];
    const shade: Keyframe[] = [];
    const size: Keyframe[] = [];
    const point = (ms: number, h: number, easing: string) => {
      path.push({ offset: at(ms), translate: `0 ${-h}px`, easing });
      shade.push({ offset: at(ms), scale: String(1 - Math.min(h, 300) / 450), opacity: String(Math.max(0, 1 - h / 360)), easing });
    };
    let t = 0;
    if (fall) {
      point(0, from, FALL);
      size.push({ offset: 0, scale: STRETCH });
      t = fall;
      size.push({ offset: at(t - 16), scale: STRETCH });
    }
    point(t, 0, RISE);
    size.push({ offset: at(t), scale: squash(from) });
    for (const [ms, up] of hops) {
      size.push({ offset: at(t + ms * 0.3), scale: '.94 1.06' }, { offset: at(t + ms * 0.5), scale: '1 1' });
      point(t + ms / 2, up, FALL);
      t += ms;
      point(t, 0, RISE);
      size.push({ offset: at(t - 16), scale: STRETCH }, { offset: at(t), scale: squash(up) });
    }
    size.push({ offset: at(t + SETTLE_MS * 0.45), scale: '.97 1.03' }, { offset: 1, scale: '1 1' });
    const opts: KeyframeAnimationOptions = { duration: total, delay, fill: fall ? 'backwards' : 'none' };
    const anims = [this.toyBody.animate(size, opts)];
    if (fall || hops.length) {
      path.push({ offset: 1, translate: '0 0' });
      shade.push({ offset: 1, scale: '1', opacity: '1' });
      anims.push(this.toyBody.animate(path, opts), this.toyShadow.animate(shade, opts));
    }
    return anims;
  }

  /** Кубик перекатывается: на каждой четверти оборота центр поднимается на ребро, в такт повороту картинки. */
  private tumble(quarters: number): Animation {
    const lift = `0 -${Math.round(TOY * 0.2)}px`;
    const frames: Keyframe[] = [];
    for (let k = 0; k < quarters; k++) {
      frames.push({ offset: k / quarters, translate: '0 0', easing: 'ease-out' }, { offset: (k + 0.5) / quarters, translate: lift, easing: 'ease-in' });
    }
    frames.push({ offset: 1, translate: '0 0' });
    return this.toyBody.animate(frames, { duration: 1000, easing: ROLL });
  }

  private stopToy(): void {
    this.toyAnims.forEach((a) => a.cancel());
    this.toyAnims = [];
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
