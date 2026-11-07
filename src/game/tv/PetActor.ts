import { ART } from '@/art/manifest';
import type { Mood, PetState } from '@/engine/pet';
import type { GroupCode } from '@/engine/types';
import { petScale, stageSprite } from '@/game/PetView';
import { EMOTE, PLUS, type Emote } from './art';
import { kickBall } from './ball';
import { headingAt, pathLength, pointAt, type Pt } from './hallGames';
import { HUG_MS, SPIN_MS, type RoomView } from './RoomView';
import type { ToyPlay } from './toys';

type Kind = 'egg' | 'pet' | 'grave';

/** Высота картинки в мире: питомец растёт со стадией, яйцо и надгробие постоянного размера. */
const PET_SIZE = 170;
const EGG_SIZE = 110;
const GRAVE_SIZE = 120;
/** Скорость шага, px мира в мс: в зале шаг крупнее (камера отдалена, питомец больше); больной ходит медленнее. */
export const SPEED = { room: 0.13, hall: 0.2 };
const SICK = 0.55;
/** Питомец не подходит к стене комнаты ближе этого. */
const EDGE = 70;
const MOOD_EMOTE: Record<Mood, Emote | null> = { ok: 'ok', sad: 'sad', bored: 'bored', sick: 'sick', dead: null };

/** Сколько живёт красный плюс аптечки, мс. */
const HEAL_MS = 2000;
const HEAL_STILL_MS = 1000;

/** На каком расстоянии от мяча или игрушки (центр к центру) питомец встаёт играть: игрушки крупнее мяча. */
const REACH: Record<ToyPlay | 'ball', number> = { ball: 58, roll: 64, bounce: 64, spin: 70, hug: 56 };
/** Питомец крупнее стольких px (сторона картинки) встаёт к игрушке дальше в той же пропорции: иначе ноги на игрушке. */
const REACH_SIZE = 120;
/** Прыжок от радости (только картинка): присел, взлетел, приземлился со сплющиванием; мс. */
const JUMP_MS = 650;
const RISE = 'cubic-bezier(.5, 1, .89, 1)';
const FALL = 'cubic-bezier(.11, 0, .5, 0)';
/** Объятия: питомец тянется к мишке и дважды сжимает его (в такт `RoomView.hugToy`). */
const HUG: Keyframe[] = [
  { rotate: '0deg', translate: '0 0', scale: '1 1', easing: 'ease-out' },
  { rotate: '13deg', translate: '16px 0', scale: '1.03 .97', offset: 0.18, easing: 'ease-in-out' },
  { rotate: '10deg', translate: '18px 0', scale: '1.09 .91', offset: 0.3, easing: 'ease-in-out' },
  { rotate: '14deg', translate: '16px 0', scale: '1 1', offset: 0.45, easing: 'ease-in-out' },
  { rotate: '10deg', translate: '18px 0', scale: '1.09 .91', offset: 0.65, easing: 'ease-in-out' },
  { rotate: '12deg', translate: '16px 0', scale: '1 1', offset: 0.8, easing: 'ease-in' },
  { rotate: '0deg', translate: '0 0', scale: '1 1' },
];
/** Сердечки над мишкой (сбоку от питомца, не на морде): сдвиг наружу к концу полёта, px. */
const HEARTS = [10, 24, 40];
const HEARTS_AT = 76;
/** Потуга перед кучкой: до «пум», мс; распрямление с отдачей после; сколько толчков дрожи. */
const STRAIN_MS = 1200;
const RELEASE_MS = 480;
const SHAKES = 22;

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

const div = (cls: string) => {
  const node = document.createElement('div');
  node.className = cls;
  return node;
};

/** Цель перехода: чего нет — остаётся прежним; `s` — масштаб (в зале питомец крупнее). */
export interface Move {
  x?: number;
  y?: number;
  s?: number;
}

/**
 * Питомец группы в слое мира (поверх домика): яйцо, питомец или надгробие; ноги в точке (`x`, `y`), масштаб `s`.
 * Живой вылупившийся питомец бродит по своей комнате и пинает её мяч. Любая смена вида, `setRunning(false)` или
 * `hold()` останавливает текущий цикл (`gen`): движение, начатое до смены, дальше не идёт.
 * Прогулку ведёт `Hall`: `hold()` отдаёт ему питомца (жетон — номер цикла), `release()` возвращает в комнату.
 */
export class PetActor {
  readonly el: HTMLElement;
  readonly shadow: HTMLElement;
  x: number;
  y: number;
  s = 1;
  facing: 1 | -1 = 1;
  /** % плана оплат (из `PetState.planPercent`); по нему в зале выбирают, кто кого кусает. */
  plan: number | null = null;
  private readonly sprite: HTMLImageElement;
  private readonly flip: HTMLElement;
  private readonly bubble: HTMLElement;
  private readonly talk: HTMLElement;
  private kind: Kind | null = null;
  private state: Mood = 'ok';
  private running = false;
  private gen = 0;
  private side = PET_SIZE;
  private emoteTimer: ReturnType<typeof setTimeout> | undefined;
  private sayTimer: ReturnType<typeof setTimeout> | undefined;
  private healTimer: ReturnType<typeof setTimeout> | undefined;
  private healEl: HTMLElement | null = null;
  private readonly bob: HTMLElement;
  /** прыжок или объятия картинки (WAAPI на `.bob`): останавливаются вместе с циклом */
  private acts: Animation[] = [];
  /** новая игрушка: следующий заход в комнате — сразу к ней */
  private eager = false;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(readonly group: GroupCode, readonly room: RoomView) {
    this.x = room.rect.cx;
    this.y = room.rect.floorY;
    this.el = div('pet');
    this.flip = div('flip');
    const bob = div('bob');
    this.bob = bob;
    this.sprite = new Image();
    this.sprite.alt = '';
    this.sprite.decoding = 'async';
    bob.append(this.sprite);
    this.flip.append(bob);
    this.bubble = div('emote');
    this.talk = div('emote say');
    this.el.append(this.flip, this.bubble, this.talk);
    this.shadow = div('shadow');
    this.shadow.append(document.createElement('i'));
    this.place();
  }

  update(s: PetState): void {
    const kind: Kind = !s.alive ? 'grave' : s.phase === 'pet' ? 'pet' : 'egg';
    const src = kind === 'grave' ? ART.grave
      : kind === 'egg' ? ART.eggs[this.group][Number(s.phase.slice(3))]
      : stageSprite(ART.pets[this.group], s.stage);
    if (this.sprite.getAttribute('src') !== src) this.sprite.src = src;
    const size = kind === 'pet' ? Math.round(PET_SIZE * petScale(s.stage)) : kind === 'egg' ? EGG_SIZE : GRAVE_SIZE;
    this.el.style.setProperty('--size', `${size}px`);
    this.side = size;
    this.el.dataset.kind = kind;
    this.el.dataset.mood = s.mood;
    this.state = s.mood;
    this.plan = s.planPercent;
    if (kind === this.kind) return;
    const hatched = this.kind === 'egg' && kind === 'pet';
    this.kind = kind;
    this.halt();
    this.goHomeNow(true);
    this.face(1);
    if (hatched) this.emote('joy', 2500);
    this.walkIfAllowed();
  }

  /** Гуляет ли (живой вылупившийся при видимой вкладке): только такие выходят в зал. */
  get walker(): boolean {
    return this.running && this.kind === 'pet';
  }

  /** Сторона картинки, px (`--size`): крупные держатся дальше от игрушки и от места кучки. */
  get size(): number {
    return this.side;
  }

  get mood(): Mood {
    return this.state;
  }

  /** Движение разрешено, пока вкладка видна; без него питомец стоит в своей комнате. */
  setRunning(on: boolean): void {
    if (on === this.running) return;
    this.running = on;
    if (on) this.walkIfAllowed();
    else {
      this.halt();
      this.goHomeNow();
    }
  }

  /** Остановить блуждание и отдать питомца сценарию; жетон годен, пока питомца не перехватили. */
  hold(): number {
    this.halt();
    return this.gen;
  }

  owns(token: number): boolean {
    return token === this.gen;
  }

  /** Вернуть в комнату (кто не дошёл — сразу на место) и снова пустить бродить. */
  release(): void {
    this.halt();
    this.goHomeNow();
    this.walkIfAllowed();
  }

  emote(kind: Emote, ms = 1600): void {
    this.bubble.innerHTML = `<svg viewBox="0 0 40 40" aria-hidden="true">${EMOTE[kind]}</svg>`;
    this.bubble.classList.add('on');
    clearTimeout(this.emoteTimer);
    this.emoteTimer = setTimeout(() => this.bubble.classList.remove('on'), ms);
  }

  /** Облачко с репликой над питомцем (отдельное от значка: реплика и значок не гасят друг друга). */
  say(text: string, ms = 1600): void {
    this.talk.textContent = text;
    this.talk.classList.add('on');
    this.place(); // говорящий выше соседа на той же линии: иначе облачко уходит под более крупного питомца
    clearTimeout(this.sayTimer);
    this.sayTimer = setTimeout(() => {
      this.talk.classList.remove('on');
      this.place();
    }, ms);
  }

  /** Присел на месте (через него прыгают в чехарде); снимается и сам, когда цикл питомца останавливают. */
  crouch(on: boolean): void {
    this.el.classList.toggle('sneak', on);
  }

  /** Крадущийся шаг до точки (пригнувшись, втрое медленнее зала); `false`, если питомца перехватили. */
  async sneak(x: number, y: number, token: number): Promise<boolean> {
    this.el.classList.add('sneak');
    try {
      return await this.walk(x, y, token, SPEED.hall / 3);
    } finally {
      this.el.classList.remove('sneak');
    }
  }

  /**
   * Лечение аптечкой РГ: красный плюс над питомцем растёт, пульсирует и рассыпается шестью маленькими; питомец светится
   * (`data-healing`). Убирается сам по таймеру; при reduced motion — плюс на 1 с без движения.
   */
  heal(): void {
    if (this.kind === 'grave') return; // движок не лечит погибшего: плюса над могилой нет
    this.healEl?.remove();
    clearTimeout(this.healTimer);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ms = still ? HEAL_STILL_MS : HEAL_MS;
    const plus = (cls: string, style = '') => `<svg class="${cls}" style="${style}" viewBox="0 0 40 40" aria-hidden="true">${PLUS}</svg>`;
    const el = div('heal');
    if (still) el.classList.add('still');
    el.style.setProperty('--heal-ms', `${ms}ms`);
    el.innerHTML = plus('big') + Array.from({ length: 6 }, (_, k) => {
      const a = (k / 6) * Math.PI * 2 - Math.PI / 2;
      return plus('bit', `--dx:${Math.round(Math.cos(a) * 70)}px;--dy:${Math.round(Math.sin(a) * 70)}px`);
    }).join('');
    this.el.append(el);
    this.el.dataset.healing = '';
    this.healEl = el;
    this.healTimer = setTimeout(() => {
      el.remove();
      delete this.el.dataset.healing;
      this.healEl = null;
      this.emote('joy', 1300); // радуется, когда плюс рассыпался (облачко не перекрывает плюс)
    }, ms);
  }

  /**
   * Новая игрушка упала в комнату: прыжок от радости, потом сердечко (когда питомец уже на полу); следующий заход
   * в комнате — сразу к игрушке. Координаты и цикл не трогает: в зале питомец просто подпрыгнет на месте.
   */
  cheer(): void {
    this.eager = true;
    this.joy();
  }

  /** Радость (конец игры в зале): прыжок на месте, потом сердечко, когда питомец уже на полу. Цикл не трогает. */
  joy(): void {
    this.jump(46);
    setTimeout(() => this.emote('joy', 1300), JUMP_MS);
  }

  /**
   * Тужится (событие «итоги дня», перед кучкой): присел и сплющился, дрожит всё сильнее, толчками дожимает, с макушки
   * летят капли пота. Промис — к «пум» (`STRAIN_MS`); дальше питомец сам распрямляется с отдачей (вытянулся, пружинит).
   * При reduced motion — сразу.
   */
  strain(): Promise<void> {
    if (this.reduced || !this.bob.animate) return Promise.resolve();
    const k = (scale: string, offset: number) => ({ scale, offset, easing: 'ease-in-out' });
    this.act([k('1 1', 0), k('1.2 .76', 0.1), k('1.12 .85', 0.2), k('1.18 .78', 0.34), k('1.12 .85', 0.46), k('1.2 .77', 0.6),
      k('1.13 .84', 0.72), k('1.24 .73', 0.88), k('1.26 .71', 1)], STRAIN_MS);
    const shake: Keyframe[] = [{ translate: '0 0', offset: 0 }, { translate: '0 0', offset: 0.14 }];
    for (let j = 1; j <= SHAKES; j++) {
      const amp = (1.2 + (2.8 * j) / SHAKES) * (j % 2 ? 1 : -1);
      shake.push({ translate: `${amp.toFixed(1)}px 0`, offset: 0.14 + (0.84 * j) / SHAKES });
    }
    shake.push({ translate: '0 0', offset: 1 });
    this.act(shake, STRAIN_MS);
    const r = (scale: string, offset: number) => ({ scale, offset, easing: 'ease-out' });
    this.act([r('1.26 .71', 0), r('.82 1.22', 0.2), r('1.1 .92', 0.45), r('.96 1.04', 0.7), r('1 1', 1)], RELEASE_MS, { delay: STRAIN_MS });
    this.act([{ scale: '1' }, { scale: '1.18 1', offset: 0.1 }, { scale: '1.22 1', offset: 0.9 }, { scale: '1' }], STRAIN_MS, {}, this.shadow.firstElementChild as HTMLElement);
    const sweat = div('sweat');
    sweat.innerHTML = [-1, 1, -1, 1].map((side, j) => `<i style="--dx:${side * (34 + j * 6)}px;animation-delay:${180 + j * 240}ms"></i>`).join('');
    this.el.append(sweat);
    setTimeout(() => sweat.remove(), STRAIN_MS + 200);
    return new Promise((resolve) => setTimeout(resolve, STRAIN_MS));
  }

  /** Шаг до точки с обычной скоростью (в комнате или в зале). */
  walk(x: number, y: number, token: number, speed = SPEED.room): Promise<boolean> {
    const d = Math.hypot(x - this.x, y - this.y);
    return this.moveTo({ x, y }, Math.max(250, d / (this.state === 'sick' ? speed * SICK : speed)), token);
  }

  /**
   * Переход за `ms`; `arc` — прыжок дугой такой высоты (px мира). `false`, если питомца перехватили.
   * В фоне кадров нет — переход всё равно заканчивается по таймеру.
   */
  moveTo(to: Move, ms: number, token: number, arc = 0): Promise<boolean> {
    const from = { x: this.x, y: this.y, s: this.s };
    const tx = to.x ?? from.x;
    const ty = to.y ?? from.y;
    const ts = to.s ?? from.s;
    if (Math.abs(tx - from.x) > 3) this.face(tx < from.x ? -1 : 1);
    this.el.classList.add('walking');
    return new Promise((resolve) => {
      const t0 = performance.now();
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(safety);
        if (ok) this.el.classList.remove('walking');
        resolve(ok);
      };
      const step = (now: number) => {
        if (done) return;
        if (token !== this.gen) return finish(false);
        const k = Math.min(1, (now - t0) / ms);
        const e = arc ? k : ease(k);
        this.x = from.x + (tx - from.x) * e;
        this.y = from.y + (ty - from.y) * e;
        this.s = from.s + (ts - from.s) * e;
        this.place(arc ? Math.sin(Math.PI * k) * arc : 0);
        if (k < 1) requestAnimationFrame(step);
        else finish(true);
      };
      // Infinity, а не t0 + ms: из-за округления `(t0 + ms − t0) / ms` бывает чуть меньше 1, и переход ждал бы кадра
      const safety = setTimeout(() => step(Infinity), ms + 150);
      requestAnimationFrame(step);
    });
  }

  /**
   * Бег от текущей точки через `points` с постоянной скоростью `speed` (px мира в мс; больной — в `SICK` раз медленнее),
   * без разгона и торможения: на длинном пути с изгибами ход ровный. Смотрит по ходу отрезка, почти вертикальный
   * отрезок (|dx| ≤ 3) не разворачивает. `false`, если питомца перехватили. В фоне кадров нет — по таймеру сразу в конец.
   */
  run(points: readonly Pt[], speed: number, token: number): Promise<boolean> {
    const path = [{ x: this.x, y: this.y }, ...points];
    const len = pathLength(path);
    const v = this.state === 'sick' ? speed * SICK : speed;
    this.el.classList.add('walking');
    return new Promise((resolve) => {
      const t0 = performance.now();
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(safety);
        if (ok) this.el.classList.remove('walking');
        resolve(ok);
      };
      const step = (now: number) => {
        if (done) return;
        if (token !== this.gen) return finish(false);
        const d = Math.min(len, (now - t0) * v);
        const dir = headingAt(path, d);
        if (dir && dir !== this.facing) this.face(dir);
        const p = pointAt(path, d);
        this.x = p.x;
        this.y = p.y;
        this.place();
        if (d < len) requestAnimationFrame(step);
        else finish(true);
      };
      // Infinity, а не t0 + ms: из-за округления `(t0 + ms − t0) × v` бывает чуть меньше длины, и бег ждал бы кадра
      const safety = setTimeout(() => step(Infinity), len / v + 150);
      requestAnimationFrame(step);
    });
  }

  face(dir: 1 | -1): void {
    this.facing = dir;
    this.flip.style.transform = `scaleX(${dir})`;
  }

  private walkIfAllowed(): void {
    if (this.walker) void this.wander(++this.gen);
  }

  private halt(): void {
    this.gen++;
    this.el.classList.remove('walking', 'sneak');
    this.acts.forEach((a) => a.cancel());
    this.acts = [];
  }

  /** Вне комнаты (в зале, в прыжке) — сразу на пол своей комнаты; `center` — ещё и в её середину. */
  private goHomeNow(center = false): void {
    const r = this.room.rect;
    if (center || this.s !== 1 || this.y !== r.floorY) this.x = r.cx;
    this.y = r.floorY;
    this.s = 1;
    this.place();
  }

  /**
   * Бродит по комнате: иногда подходит к мячу (или игрушке дня) и играет, иногда просто идёт в случайную точку.
   * Мяч и катящиеся игрушки пинает (уточка от пинка скачет), юлу закручивает, мишку обнимает.
   */
  private async wander(my: number): Promise<void> {
    const r = this.room.rect;
    const ball = this.room.ball;
    while (my === this.gen) {
      const play = this.room.play; // null — игрушка ещё падает
      if (play && (this.eager || Math.random() < 0.4)) {
        this.eager = false;
        const dir = r.x + ball.x > this.x ? 1 : -1;
        if (!(await this.walkTo(r.x + ball.x - dir * REACH[play] * this.far(), my))) return;
        // пока шёл, РГ мог бросить новую игрушку: в руке и в падении её не трогают
        const still = this.room.play === play;
        if (still) this.face(dir);
        if (still && (play === 'hug' || play === 'spin')) {
          if (!(await (play === 'hug' ? this.hug(my) : this.spin(my)))) return;
        } else if (still) {
          const kick = kickBall(ball.x, this.x - r.x, r.w, Math.random);
          ball.rot += kick.rot;
          ball.x = kick.x;
          this.room.placeBall(kick.toss);
          if (kick.toss) {
            // облачко только после полёта мяча (700 мс): иначе оно закрывает мяч в верхней точке дуги
            if (!(await this.moveTo({}, 420, my, 40))) return;
            if (!(await this.pause(300, my))) return;
            this.emote('joy', 1300);
          } else if (this.state === 'ok' && Math.random() < 0.5) this.emote('joy', 1300);
        }
      } else if (!(await this.walkTo(r.x + EDGE + Math.random() * (r.w - 2 * EDGE), my))) {
        return;
      }
      if (!(await this.pause(500 + Math.random() * 1600, my))) return;
      const mood = MOOD_EMOTE[this.state];
      if (mood && this.state !== 'ok' && Math.random() < 0.5) this.emote(mood);
    }
  }

  /** Обнимает мишку: тянется к нему и дважды сжимает, над объятиями — сердечки; потом сердечко в облачке. */
  private async hug(my: number): Promise<boolean> {
    this.room.hugToy();
    this.act(HUG, HUG_MS);
    if (!this.reduced) {
      const hearts = div('hearts');
      hearts.style.left = `${this.facing * HEARTS_AT * this.far()}px`;
      hearts.innerHTML = HEARTS.map((dx, k) => `<svg style="--dx:${dx * this.facing}px;animation-delay:${k * 230}ms" viewBox="0 0 40 40" aria-hidden="true">${EMOTE.joy}</svg>`).join('');
      this.el.append(hearts);
      setTimeout(() => hearts.remove(), HUG_MS + 200);
    }
    if (!(await this.pause(HUG_MS, my))) return false;
    this.emote('joy', 1300);
    return true;
  }

  /** Закручивает юлу: толкает её наклоном, на середине подпрыгивает от восторга, к концу иногда радуется. */
  private async spin(my: number): Promise<boolean> {
    this.act([{ rotate: '0deg' }, { rotate: '12deg', offset: 0.4, easing: 'ease-in' }, { rotate: '0deg' }], 320, { easing: 'ease-out' });
    if (!(await this.pause(140, my))) return false;
    this.room.spinToy();
    if (!(await this.pause(SPIN_MS / 2, my))) return false;
    this.jump(28);
    if (!(await this.pause(SPIN_MS / 2 - 140, my))) return false;
    if (this.state === 'ok' && Math.random() < 0.5) this.emote('joy', 1300);
    return true;
  }

  /** Прыжок на месте высотой `h` px (только картинка `.bob` и тень, координаты не меняются). */
  private jump(h: number): void {
    this.act(
      [
        { translate: '0 0', easing: 'ease-out' },
        { translate: '0 0', offset: 0.2, easing: RISE },
        { translate: `0 -${h}px`, offset: 0.5, easing: FALL },
        { translate: '0 0', offset: 0.8 },
        { translate: '0 0' },
      ],
      JUMP_MS,
    );
    this.act(
      [
        { scale: '1 1' },
        { scale: '1.14 .84', offset: 0.2 },
        { scale: '.9 1.12', offset: 0.3 },
        { scale: '1 1', offset: 0.5 },
        { scale: '.94 1.06', offset: 0.74 },
        { scale: '1.14 .86', offset: 0.8 },
        { scale: '1 1' },
      ],
      JUMP_MS,
    );
    this.act([{ scale: '1' }, { scale: '1', offset: 0.2 }, { scale: '.7', offset: 0.5 }, { scale: '1', offset: 0.8 }, { scale: '1' }], JUMP_MS, {}, this.shadow.firstElementChild as HTMLElement);
  }

  /** Анимация картинки (по умолчанию `.bob`) поверх её покачивания; при reduced motion — ничего. */
  private act(frames: Keyframe[], ms: number, opts: KeyframeAnimationOptions = {}, node: HTMLElement = this.bob): void {
    if (this.reduced || !node.animate) return;
    this.acts = this.acts.filter((a) => a.playState !== 'finished');
    this.acts.push(node.animate(frames, { duration: ms, ...opts }));
  }

  private pause(ms: number, my: number): Promise<boolean> {
    return new Promise((resolve) => setTimeout(() => resolve(my === this.gen), ms));
  }

  /** Шаг по полу своей комнаты до `tx`. */
  private walkTo(tx: number, my: number): Promise<boolean> {
    return this.walk(tx, this.y, my);
  }

  /** Во сколько раз дальше от игрушки встаёт крупный питомец (`REACH_SIZE`): мелкие — как в `REACH`. */
  private far(): number {
    return Math.max(1, this.side / REACH_SIZE);
  }

  /**
   * `lift` — высота над полом в прыжке: тень остаётся на полу и уменьшается. Прыгун в воздухе выше стоящего на той же
   * линии (чехарда: ноги над пригнувшимся, а не за ним).
   */
  private place(lift = 0): void {
    this.el.style.transform = `translate(${this.x}px, ${this.y - lift}px) scale(${this.s})`;
    this.shadow.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.s * (1 - Math.min(lift, 300) / 500)})`;
    this.el.style.zIndex = String(10 + Math.round(this.y) + (this.talk.classList.contains('on') ? 1 : 0) + (lift > 1 ? 1 : 0));
    this.shadow.style.zIndex = String(9 + Math.round(this.y));
  }
}
