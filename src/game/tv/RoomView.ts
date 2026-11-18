import { ART, GROUP_KEY, THEME } from '@/art/manifest';
import type { PetState } from '@/engine/pet';
import { PLACES, type Place, type ShopState } from '@/engine/shop';
import type { GroupCode } from '@/engine/types';
import { MOOD_LABEL } from '@/game/PetView';
import { DECOR, GIFT, PLUS, SPARK } from './art';
import { SCREEN, furnitureLayout, spotX } from './furniture';
import { HOUSE, type RoomRect } from './layout';
import { tickerItems, type FunnelTotal, type TickerItem } from './metrics';
import type { ToyFx, ToyKey, Trick } from './toyTricks';
import { TOYS, toyHeight, type ToyKind, type ToyPlay } from './toys';

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
/** Пол под игрушкой — низ рамки `.toy` (`tv.css`), px от верха комнаты. */
const TOY_FLOOR = 410;
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
/** Ряд кучек (как `.tv-piles` в `tv.css`): отступ слева, ширина кучки и промежуток, px комнаты. */
const PILES_LEFT = 14;
const PILE_W = 36;
const PILE_GAP = 4;
/** Новые кучки «пум» выскакивают по очереди через столько, мс. */
const PILE_STAGGER_MS = 170;
/** Середина надписи «пум!» в ряду кучек не левее этого, px: иначе левая стена комнаты её обрезает. */
const PUM_MIN_X = 46;
/** Кучка исчезает облачком: сама сжимается, облачко живёт `POOF_MS`; мухи без кучек улетают. */
const POOF_MS = 760;
/** Ящик-аптечка или подарок падает в ящик запасов: сторона картинки px, падение до удара и вся анимация, мс. */
const DROP = 54;
export const CRATE_LAND_MS = 640;
const CRATE_MS = 980;
const SPARKS = 7;
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
 * `el` — `[data-group]` с `data-phase/mood/stage/piles/medkits/toys` — всегда настоящее состояние: на них опираются
 * проверки экрана. Видимое (табличка, кучки, счётчики) в событии «итоги дня» может придерживаться прежним (`update`).
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
  /** трюк новой игрушки: нитка йо-йо и мелочи вокруг (пузыри, нотки, дымок, «дзынь!»), снимаются вместе с ним */
  private trickFx: HTMLElement[] = [];
  private trickTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly species: HTMLElement;
  private readonly mood: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly sat: HTMLElement;
  private readonly slot: HTMLElement;
  private readonly piles: HTMLElement;
  private readonly inv: HTMLElement;
  private readonly crates: Record<'medkits' | 'toys', { box: HTMLElement; count: HTMLElement }>;
  /** видимые запасы (вместе с ящиками, которые ещё падают) и сколько ящиков каждого вида ещё в воздухе */
  private readonly stock = { medkits: 0, toys: 0 };
  private readonly falling = { medkits: 0, toys: 0 };
  private items: TickerItem[] = [];
  private tickN = 0;
  private shownItem = '';
  private pilesShown = -1;
  private hands = 0;
  /** мебель магазина: слой над полом и под табличкой; `furnKey` — что стоит сейчас, `screens` — экраны компьютера */
  private readonly furn: HTMLElement;
  private furnKey = '';
  private screens: HTMLElement[] = [];
  /** последний магазин группы из `setFurniture` (`null` — магазина нет) */
  shop: ShopState | null = null;
  /** звонок клиента: «дзынь!» над телефоном и облачко «Клиент» (снимаются в `stopCall`) */
  private ringEl: HTMLElement | null = null;
  private clientEl: HTMLElement | null = null;
  private clientTimer: ReturnType<typeof setTimeout> | undefined;

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
      const box = el('div', 'crate');
      box.title = tip;
      box.append(img('', icon), count);
      return { box, count };
    };
    this.crates = {
      medkits: crate('medkits', ART.medkit, 'Аптечки: лечат болезнь'),
      toys: crate('toys', ART.toy, 'Игрушки: лечат скуку и грусть'),
    };
    const inv = el('div', 'inv');
    this.inv = inv;
    inv.append(this.crates.medkits.box, this.crates.toys.box);

    this.ballEl = el('div', 'ball');
    this.ball.x = 150 + (index % 3) * 110;
    this.tickN = index; // соседние табло показывают разные цифры, как в макете
    this.placeBall();
    this.toyEl = el('div', 'toy');
    this.toyShadow = el('i', 'toy-shadow');
    this.toyBody = el('div', 'toy-body');
    this.toyEl.append(this.toyShadow, this.toyBody);
    this.furn = el('div', 'furn');

    this.el.append(wall, decor, floor, this.furn, sign, ticker, this.piles, inv, this.ballEl, this.toyEl);
  }

  /**
   * Мебель магазина группы: слой перерисовывается, только когда сменилась мебель; цифры на экране компьютера (оплаты
   * за сегодня и % плана) — на каждом обновлении. У двух мониторов цифры поровну: слева оплаты, справа процент.
   */
  setFurniture(shop: ShopState | null, s: PetState): void {
    this.shop = shop;
    const owned = shop?.owned ?? {};
    const key = PLACES.map((p) => owned[p] ?? '').join();
    if (key !== this.furnKey) {
      this.furnKey = key;
      this.screens = [];
      this.furn.replaceChildren(...furnitureLayout(owned, THEME[this.group].decor).map(({ id, place, box, z }) => {
        const node = el('div', 'fi');
        node.dataset.place = place;
        node.dataset.item = id;
        node.style.cssText = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;z-index:${z}`;
        node.append(img('', ART.furniture[id]));
        for (const sc of SCREEN[id as keyof typeof SCREEN] ?? []) {
          const screen = el('div', 'screen');
          // шрифт по ширине экрана: «100%» влезает и в узкий монитор пары
          const font = Math.min(13, Math.floor((sc.w * box.w) / 3.6));
          screen.style.cssText = `left:${sc.x * 100}%;top:${sc.y * 100}%;width:${sc.w * 100}%;height:${sc.h * 100}%;font-size:${font}px`;
          this.screens.push(screen);
          node.append(screen);
        }
        return node;
      }));
    }
    const lines = [`+${shop?.today ?? 0}`, `${s.planPercent ?? 0}%`];
    this.screens.forEach((screen, i) => {
      const text = (this.screens.length > 1 ? [lines[i] ?? ''] : lines).join('\n');
      if (screen.textContent !== text) screen.textContent = text;
    });
  }

  /** Вещь на месте `place` (дрожь телефона, мигание экрана) или `null`. */
  furnitureEl(place: Place): HTMLElement | null {
    return this.furn.querySelector<HTMLElement>(`[data-place="${place}"]`);
  }

  /** Где встать питомцу у телефона, компьютера или в углу, px комнаты; `null` — вещи нет. */
  spot(place: 'phone' | 'pc' | 'corner'): number | null {
    return spotX(place, this.shop?.owned ?? {});
  }

  /**
   * Звонит телефон: у комнаты `data-call`, телефон дрожит, над ним «дзынь!» (при reduced motion — только `data-call`).
   * Трубку снимают первой репликой клиента (`clientSay`), весь звонок убирает `stopCall`.
   */
  ring(): void {
    const phone = this.furnitureEl('phone');
    if (!phone) return;
    this.el.dataset.call = '1';
    if (this.reduced) return;
    phone.classList.add('ringing');
    this.ringEl?.remove();
    this.ringEl = el('i', 'toy-fx ring call-ring', 'дзынь!');
    this.ringEl.style.left = `${phone.offsetLeft + phone.offsetWidth / 2}px`;
    this.ringEl.style.top = `${phone.offsetTop - 16}px`;
    this.el.append(this.ringEl);
  }

  /** Реплика клиента в облачке «Клиент» над столом на `ms`; первая снимает трубку (дрожь и «дзынь!» гаснут). */
  clientSay(text: string, ms: number): void {
    this.hangRing();
    this.clientEl?.remove();
    const bubble = el('div', 'client-say');
    bubble.append(el('b', '', 'Клиент'), el('span', '', text));
    this.el.append(bubble);
    this.clientEl = bubble;
    clearTimeout(this.clientTimer);
    this.clientTimer = setTimeout(() => {
      bubble.remove();
      if (this.clientEl === bubble) this.clientEl = null;
    }, ms);
  }

  /** Звонок окончен или прерван: ни облачка, ни дрожи, ни `data-call`. */
  stopCall(): void {
    this.hangRing();
    clearTimeout(this.clientTimer);
    this.clientEl?.remove();
    this.clientEl = null;
    delete this.el.dataset.call;
  }

  private hangRing(): void {
    this.furnitureEl('phone')?.classList.remove('ringing');
    this.ringEl?.remove();
    this.ringEl = null;
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
    this.stopCall(); // новая игрушка дня обрывает и звонок (питомец увидит это по `data-call`)
    this.toyEl.classList.remove('spin');
    this.toyKind = kind;
    this.landAt = 0;
    if (!kind) {
      delete this.el.dataset.toy;
      return;
    }
    this.el.dataset.toy = kind;
    this.toyEl.style.setProperty('--toy-h', `${toyHeight(kind)}px`);
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

  /** Высота рамки игрушки дня, px: от неё считается середина игрушки (нитка йо-йо, лапа). */
  get toyH(): number {
    return this.toyKind ? toyHeight(this.toyKind) : TOY;
  }

  /**
   * Трюк новой игрушки (`toyTricks.ts`): тело и тень идут по ключевым кадрам `t.keys`, а рамка сразу встаёт в `endX`
   * (туда же молча переезжает спрятанный мяч), чтобы оборванный трюк оставил игрушку там, где ей лежать. Нитка йо-йо и
   * мелочи вокруг живут в комнате до конца трюка; пока он идёт, у комнаты `data-trick`. `false` — не играем: reduced
   * motion, игрушка ещё падает или в комнате другая игрушка.
   */
  playTrick(t: Trick): boolean {
    if (this.reduced || !this.toyBody.animate || !this.toyKind || performance.now() < this.landAt) return false;
    if (TOYS.find((x) => x.kind === this.toyKind)!.play !== t.play) return false;
    this.stopToy();
    const pic = this.toyBody.firstElementChild as HTMLElement;
    if (t.face) {
      // разворот сразу, без перехода `scale` из `tv.css`: иначе машинка ~0,2 с едет носом назад или мигает через ноль
      pic.style.transition = 'none';
      pic.style.scale = t.face < 0 ? '-1 1' : '';
      void pic.offsetWidth;
      pic.style.transition = '';
    }
    const end = t.endX;
    if (end !== this.toyX) {
      this.toyX = end;
      this.ball.x = end;
      this.shown = `translate(${end - BALL / 2}px, 0) rotate(${this.ball.rot}deg)`;
      this.ballEl.style.transform = this.shown;
      this.toyEl.style.transition = 'none';
      this.toyEl.style.transform = `translate(${end - TOY / 2}px, 0)`;
      void this.toyEl.offsetWidth; // новое место без перехода: переход вернётся уже после него
      this.toyEl.style.transition = '';
    }
    const at = (k: ToyKey) => ({ offset: k.t, easing: k.ease ?? 'ease-in-out' });
    const turn = (k: ToyKey) => `${k.rot ?? 0}deg`;
    this.toyAnims = [
      this.toyBody.animate(t.keys.map((k) => ({
        ...at(k), translate: `${k.x - end}px ${-k.up}px`, scale: `${k.sx ?? 1} ${k.sy ?? 1}`, ...(t.spin ? {} : { rotate: turn(k) }),
      })), t.ms),
      this.toyShadow.animate(t.keys.map((k) => ({
        ...at(k), translate: `${k.x - end}px 0`, scale: String(1 - Math.min(k.up, 300) / 450), opacity: String(Math.max(0, 1 - k.up / 360)),
      })), t.ms),
    ];
    if (t.spin) this.toyAnims.push(pic.animate(t.keys.map((k) => ({ ...at(k), rotate: turn(k) })), t.ms));
    if (t.string) this.trickFx.push(this.yoyoString(t));
    for (const f of t.fx) this.trickFx.push(this.trickBit(f, t.ms));
    this.el.dataset.trick = t.play;
    const last = Math.max(t.ms, ...t.fx.map((f) => f.t * t.ms + f.ms));
    this.trickTimer = setTimeout(() => this.stopToy(), last + 50);
    return true;
  }

  /** Питомца увели посреди трюка: игрушка сразу на своём месте, мелочи убраны. Без трюка — ничего (падение не трогаем). */
  stopTrick(): void {
    if (this.el.dataset.trick) this.stopToy();
  }

  /** Нитка йо-йо от лапы до середины игрушки: длина идёт за игрушкой по тем же кадрам, видна, пока йо-йо в руке. */
  private yoyoString(t: Trick): HTMLElement {
    const s = t.string!;
    const line = el('i', 'toy-string');
    line.style.left = `${s.x - 1}px`;
    line.style.top = `${TOY_FLOOR - s.up}px`;
    const mid = this.toyH / 2;
    line.animate(t.keys.map((k) => ({
      offset: k.t, easing: k.ease ?? 'ease-in-out', height: `${Math.max(0, s.up - k.up - mid)}px`,
    })), t.ms);
    const seen = (offset: number, opacity: string) => ({ offset, opacity });
    line.animate([seen(0, '0'), seen(s.from, '0'), seen(Math.min(1, s.from + 0.02), '1'), seen(s.to, '1'), seen(Math.min(1, s.to + 0.02), '0'), seen(1, '0')], t.ms);
    this.el.append(line);
    return line;
  }

  /** Пузырь (всплывает, качаясь, и лопается), нотка, клуб дымка или «дзынь!» у игрушки; живёт `f.ms` с задержкой `f.t`. */
  private trickBit(f: ToyFx, trickMs: number): HTMLElement {
    const text = f.kind === 'note' ? (f.dx > 0 ? '♪' : '♫') : f.kind === 'ring' ? 'дзынь!' : undefined;
    const node = el('i', `toy-fx ${f.kind}`, text);
    node.style.left = `${f.x}px`;
    node.style.top = `${TOY_FLOOR - f.up}px`;
    if (f.kind === 'bubble') node.style.setProperty('--b', `${12 + (Math.abs(f.dx) % 9)}px`);
    const go = (p: number, o: Keyframe = {}, sway = 0): Keyframe => ({ translate: `${Math.round(f.dx * p + sway)}px ${-Math.round(f.rise * p)}px`, ...o });
    const frames: Keyframe[] = f.kind === 'bubble'
      ? [go(0, { scale: '.3', opacity: '0' }), go(0.12, { offset: 0.12, scale: '1', opacity: '.9' }), go(0.5, { offset: 0.5 }, 8),
        go(1, { offset: 0.9, scale: '1', opacity: '.9' }), go(1, { scale: '1.6', opacity: '0' })]
      : f.kind === 'smoke' ? [go(0, { scale: '.5', opacity: '0' }), go(0.1, { offset: 0.1, scale: '.6', opacity: '.85' }), go(1, { scale: '2', opacity: '0' })]
      : f.kind === 'ring' ? [go(0, { scale: '0', opacity: '1' }), go(0.3, { offset: 0.25, scale: '1.15', opacity: '1' }),
        go(0.7, { offset: 0.7, scale: '1', opacity: '1' }), go(1, { scale: '1', opacity: '0' })]
      : [go(0, { opacity: '0', rotate: '-10deg' }), go(0.2, { offset: 0.2, opacity: '1' }), go(1, { opacity: '0', rotate: '12deg' })];
    node.animate(frames, { duration: f.ms, delay: f.t * trickMs, fill: 'both', easing: 'ease-out' });
    this.el.append(node);
    return node;
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

  /**
   * `data-*` — по настоящему `s`, видимое (табличка, кучки, счётчики) — по `shown`: в событии «итоги дня» комната до конца
   * своей очереди показывает прежнее. `pop` — новые кучки выскакивают «пум» (только в очереди комнаты, после потуги);
   * без него число кучек меняется молча (в том числе когда событие придерживает «было» при запуске).
   */
  update(s: PetState, funnel?: FunnelTotal, shown?: PetState, pop = false): void {
    const d = this.el.dataset;
    d.phase = s.phase;
    d.mood = s.mood;
    d.stage = String(s.stage);
    d.piles = String(s.piles);
    d.medkits = String(s.medkits);
    d.toys = String(s.toys);
    d.alive = String(s.alive);

    const v = shown ?? s;
    this.species.textContent = v.phase === 'pet' ? THEME[this.group].species : '???';
    this.mood.textContent = MOOD_LABEL[v.mood];
    this.sub.textContent = !v.alive ? 'питомец погиб'
      : v.phase === 'pet' ? `стадия ${v.stage} · оплат ${v.totalPayments}`
      : `яйцо · оплат ${v.totalPayments}`;
    this.sat.style.width = `${v.alive ? Math.round(v.satiety * 100) : 0}%`;
    this.stock.medkits = v.medkits;
    this.stock.toys = v.toys;
    this.showCount('medkits');
    this.showCount('toys');
    this.renderPiles(v.piles, pop);

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

  /** Снять анимации игрушки и трюк целиком (мелочи, таймер, `data-trick`). */
  private stopToy(): void {
    this.toyAnims.forEach((a) => a.cancel());
    this.toyAnims = [];
    this.trickFx.forEach((n) => n.remove());
    this.trickFx = [];
    clearTimeout(this.trickTimer);
    delete this.el.dataset.trick;
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

  /** Середина места, где выскочит следующая кучка, в координатах мира: туда питомец встаёт тужиться. */
  nextPileX(): number {
    return this.rect.x + PILES_LEFT + Math.max(0, this.pilesShown) * (PILE_W + PILE_GAP) + PILE_W / 2;
  }

  /**
   * Последняя кучка исчезает облачком: приседает, подпрыгивает и тает, на её месте клубы и искры; без кучек мухи улетают.
   * Видимых кучек сразу на одну меньше (у тающей картинки нет класса `pile`); при reduced motion — просто исчезает.
   */
  poofPile(): void {
    const all = this.piles.querySelectorAll<HTMLElement>('.pile');
    const pile = all[all.length - 1];
    if (!pile) return;
    this.pilesShown = all.length - 1;
    pile.className = 'gone';
    const flies = this.pilesShown === 0 ? this.piles.querySelector<HTMLElement>('.flies') : null;
    if (this.reduced || !pile.animate) {
      pile.remove();
      flies?.remove();
      return;
    }
    const k = (scale: string, translate: string, offset: number, opacity = 1) => ({ scale, translate, offset, opacity });
    pile.animate(
      [k('1 1', '0 0', 0), k('1.28 .7', '0 0', 0.3), k('.72 1.3', '0 -14px', 0.55), k('0 0', '0 -10px', 1, 0)],
      { duration: 380, easing: 'ease-in-out', fill: 'forwards' },
    );
    const x = pile.offsetLeft + PILE_W / 2;
    const puffs = [[-34, -6, 26], [-20, -30, 30], [6, -40, 34], [30, -24, 28], [36, 2, 22], [-8, -14, 30], [14, 6, 20]];
    this.burst('poof', x, puffs.map(([dx, dy, s], j) => `<i style="--dx:${dx}px;--dy:${dy}px;--s:${s}px;animation-delay:${140 + j * 22}ms"></i>`).join('')
      + [[-30, -54], [34, -46], [2, -66]].map(([dx, dy], j) => `<svg style="--dx:${dx}px;--dy:${dy}px;animation-delay:${300 + j * 90}ms" viewBox="0 0 20 20" aria-hidden="true">${SPARK}</svg>`).join(''), POOF_MS);
    setTimeout(() => pile.remove(), POOF_MS);
    if (flies) {
      flies.animate([{ translate: '0 0', opacity: 1 }, { translate: '20px 14px', offset: 0.25 }, { translate: '90px -140px', opacity: 0 }], { duration: 900, delay: 250, easing: 'ease-in', fill: 'forwards' });
      setTimeout(() => flies.remove(), 1200);
    }
  }

  /**
   * Ящик-аптечка (`medkits`) или подарок с искрами (`toys`) падает сверху в свой ящик запасов: тянется в падении, при ударе
   * сплющивается, отскакивает и ныряет внутрь; ящик пружинит, счётчик прибавляет 1 и подпрыгивает (`CRATE_LAND_MS` после
   * вызова). Видимый запас (`update`) уже включает падающий ящик: счётчик показывает его только после удара.
   */
  dropCrate(kind: 'medkits' | 'toys'): void {
    if (this.reduced || !this.el.animate) return;
    const { box, count } = this.crates[kind];
    this.falling[kind]++;
    this.showCount(kind);
    const cx = this.inv.offsetLeft + box.offsetLeft + box.offsetWidth / 2;
    const top = this.inv.offsetTop + box.offsetTop;
    const drop = el('div', `drop ${kind}`);
    drop.style.left = `${cx - DROP / 2}px`;
    drop.style.top = `${top - DROP + 18}px`;
    drop.innerHTML = kind === 'medkits'
      ? `<img src="${ART.medkit}" alt="">`
      : `<svg viewBox="0 0 40 40" aria-hidden="true">${GIFT}</svg>${[0, 1].map((j) => `<svg class="twinkle" style="animation-delay:${j * 160}ms" viewBox="0 0 20 20" aria-hidden="true">${SPARK}</svg>`).join('')}`;
    this.el.append(drop);
    const hit = CRATE_LAND_MS / CRATE_MS;
    const at = (ms: number) => hit + ms / CRATE_MS;
    drop.animate([
      { translate: `0 ${-(top + DROP + 10)}px`, rotate: kind === 'toys' ? '-18deg' : '12deg', scale: '.84 1.16', easing: 'cubic-bezier(.5, 0, .9, .5)' },
      { translate: '0 0', rotate: '0deg', scale: '.9 1.12', offset: hit },
      { translate: '0 6px', scale: '1.36 .66', offset: at(70), easing: 'ease-out' },
      { translate: '0 -16px', scale: '.9 1.1', offset: at(170), easing: 'ease-in' },
      { translate: '0 2px', scale: '1.1 .9', offset: at(230), opacity: 1 },
      { translate: '0 26px', scale: '.3', opacity: 0, offset: 1 },
    ], { duration: CRATE_MS, fill: 'forwards' });
    setTimeout(() => drop.remove(), CRATE_MS + 50);
    setTimeout(() => {
      this.falling[kind] = Math.max(0, this.falling[kind] - 1);
      this.showCount(kind);
      box.animate([{ scale: '1 1' }, { scale: '1.2 .8', offset: 0.22 }, { scale: '.93 1.1', offset: 0.5 }, { scale: '1.04 .97', offset: 0.75 }, { scale: '1 1' }], { duration: 480, easing: 'ease-out' });
      count.animate([
        { scale: '1', translate: '0 0' },
        { scale: '1.9', translate: '0 -10px', color: 'var(--accent)', offset: 0.3 },
        { scale: '.88', translate: '0 0', offset: 0.6 },
        { scale: '1.1', offset: 0.8 },
        { scale: '1' },
      ], { duration: 620, easing: 'ease-out' });
      const art = kind === 'toys' ? [SPARK, 20] : [PLUS, 40];
      this.burst('spark', cx, Array.from({ length: SPARKS }, (_, j) => {
        const a = Math.PI * (1.08 + (0.84 * j) / (SPARKS - 1));
        return `<svg style="--dx:${Math.round(Math.cos(a) * 62)}px;--dy:${Math.round(Math.sin(a) * 58)}px" viewBox="0 0 ${art[1]} ${art[1]}" aria-hidden="true">${art[0]}</svg>`;
      }).join(''), 700, top);
    }, CRATE_LAND_MS);
  }

  private showCount(kind: 'medkits' | 'toys'): void {
    this.crates[kind].count.textContent = String(Math.max(0, this.stock[kind] - this.falling[kind]));
  }

  /** Короткая вспышка (облачко, искры, «пум!») в комнате на `ms`: в ряду кучек над `x` или в точке (`x`, `top`) комнаты. */
  private burst(cls: string, x: number, html: string, ms: number, top?: number): void {
    const node = el('div', `burst ${cls}`);
    node.style.left = `${x}px`;
    if (top !== undefined) node.style.top = `${top}px`;
    node.innerHTML = html;
    (top === undefined ? this.piles : this.el).append(node);
    setTimeout(() => node.remove(), ms);
  }

  /**
   * Кучки перестраиваются только при изменении числа; мухи существуют лишь пока есть кучки. `pop` — новые кучки
   * выскакивают «пум» по одной (с надписью и пылью), к первой кучке прилетают мухи; иначе (и убыль) — молча.
   */
  private renderPiles(n: number, pop = false): void {
    if (n === this.pilesShown) return;
    const was = this.pilesShown;
    this.pilesShown = n;
    if (!pop || was < 0 || n < was || this.reduced) {
      this.piles.replaceChildren(...Array.from({ length: n }, () => img('pile', ART.pile)));
      if (n > 0) this.piles.append(img('flies', ART.flies));
      return;
    }
    const flies = this.piles.querySelector('.flies');
    for (let k = was; k < n; k++) {
      const pile = img('pile pop', ART.pile);
      pile.style.animationDelay = `${(k - was) * PILE_STAGGER_MS}ms`;
      if (flies) flies.before(pile);
      else this.piles.append(pile);
      if (k === was) {
        // надпись над кучкой, но у левой стены сдвинута вправо: комната обрезает всё, что за её краем
        const x = k * (PILE_W + PILE_GAP) + PILE_W / 2;
        this.burst('pum', x, `<b style="--shift:${Math.max(0, PUM_MIN_X - x)}px">пум!</b><i></i><i></i>`, 1200);
      }
    }
    if (!flies) {
      const arrive = img('flies arrive', ART.flies);
      this.piles.append(arrive);
      arrive.addEventListener('animationend', (e) => { if (e.animationName === 'tv-flies-in') arrive.classList.remove('arrive'); });
    }
  }
}
