import { ART } from '@/art/manifest';
import type { Mood, PetState } from '@/engine/pet';
import type { GroupCode } from '@/engine/types';
import { petScale, stageSprite } from '@/game/PetView';
import { EMOTE, type Emote } from './art';
import { kickBall } from './ball';
import type { RoomView } from './RoomView';

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

/** Красный плюс аптечки (viewBox 40x40) и сколько он живёт, мс. */
const PLUS = '<path d="M15 3h10v12h12v10H25v12H15V25H3V15h12z" fill="#e53935" stroke="#fff" stroke-width="3" paint-order="stroke"/>';
const HEAL_MS = 2000;
const HEAL_STILL_MS = 1000;

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
  private readonly sprite: HTMLImageElement;
  private readonly flip: HTMLElement;
  private readonly bubble: HTMLElement;
  private kind: Kind | null = null;
  private state: Mood = 'ok';
  private running = false;
  private gen = 0;
  private emoteTimer: ReturnType<typeof setTimeout> | undefined;
  private healTimer: ReturnType<typeof setTimeout> | undefined;
  private healEl: HTMLElement | null = null;

  constructor(readonly group: GroupCode, readonly room: RoomView) {
    this.x = room.rect.cx;
    this.y = room.rect.floorY;
    this.el = div('pet');
    this.flip = div('flip');
    const bob = div('bob');
    this.sprite = new Image();
    this.sprite.alt = '';
    this.sprite.decoding = 'async';
    bob.append(this.sprite);
    this.flip.append(bob);
    this.bubble = div('emote');
    this.el.append(this.flip, this.bubble);
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
    this.el.dataset.kind = kind;
    this.el.dataset.mood = s.mood;
    this.state = s.mood;
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
      const safety = setTimeout(() => step(t0 + ms), ms + 150);
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
    this.el.classList.remove('walking');
  }

  /** Вне комнаты (в зале, в прыжке) — сразу на пол своей комнаты; `center` — ещё и в её середину. */
  private goHomeNow(center = false): void {
    const r = this.room.rect;
    if (center || this.s !== 1 || this.y !== r.floorY) this.x = r.cx;
    this.y = r.floorY;
    this.s = 1;
    this.place();
  }

  /** Бродит по комнате: иногда подходит к мячу и пинает его, иногда просто идёт в случайную точку. */
  private async wander(my: number): Promise<void> {
    const r = this.room.rect;
    const ball = this.room.ball;
    while (my === this.gen) {
      if (Math.random() < 0.4) {
        const dir = r.x + ball.x > this.x ? 1 : -1;
        if (!(await this.walkTo(r.x + ball.x - dir * 58, my))) return;
        this.face(dir);
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
      } else if (!(await this.walkTo(r.x + EDGE + Math.random() * (r.w - 2 * EDGE), my))) {
        return;
      }
      if (!(await this.pause(500 + Math.random() * 1600, my))) return;
      const mood = MOOD_EMOTE[this.state];
      if (mood && this.state !== 'ok' && Math.random() < 0.5) this.emote(mood);
    }
  }

  private pause(ms: number, my: number): Promise<boolean> {
    return new Promise((resolve) => setTimeout(() => resolve(my === this.gen), ms));
  }

  /** Шаг по полу своей комнаты до `tx`. */
  private walkTo(tx: number, my: number): Promise<boolean> {
    return this.walk(tx, this.y, my);
  }

  /** `lift` — высота над полом в прыжке: тень остаётся на полу и уменьшается. */
  private place(lift = 0): void {
    this.el.style.transform = `translate(${this.x}px, ${this.y - lift}px) scale(${this.s})`;
    this.shadow.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.s * (1 - Math.min(lift, 300) / 500)})`;
    this.el.style.zIndex = String(10 + Math.round(this.y));
    this.shadow.style.zIndex = String(9 + Math.round(this.y));
  }
}
