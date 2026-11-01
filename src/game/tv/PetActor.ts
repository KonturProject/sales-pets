import { ART } from '@/art/manifest';
import type { Mood, PetState } from '@/engine/pet';
import type { GroupCode } from '@/engine/types';
import { petScale } from '@/game/PetView';
import { EMOTE, type Emote } from './art';
import type { RoomView } from './RoomView';

type Kind = 'egg' | 'pet' | 'grave';

/** Высота картинки в мире: питомец растёт со стадией, яйцо и надгробие постоянного размера. */
const PET_SIZE = 170;
const EGG_SIZE = 110;
const GRAVE_SIZE = 120;
/** Скорость шага, px мира в мс; больной ходит медленнее. */
const SPEED = 0.13;
const SICK_SPEED = SPEED * 0.55;
/** Питомец не подходит к стене комнаты ближе этого. */
const EDGE = 70;
const MOOD_EMOTE: Record<Mood, Emote | null> = { ok: 'ok', sad: 'sad', bored: 'bored', sick: 'sick', dead: null };

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

const div = (cls: string) => {
  const node = document.createElement('div');
  node.className = cls;
  return node;
};

/**
 * Питомец группы в слое мира (поверх домика): яйцо, питомец или надгробие; ноги в точке (`x`, `y`).
 * Живой вылупившийся питомец бродит по своей комнате и пинает её мяч. Любая смена вида или `setRunning(false)`
 * останавливает текущий цикл (`gen`): движение, начатое до смены, дальше не идёт.
 */
export class PetActor {
  readonly el: HTMLElement;
  readonly shadow: HTMLElement;
  x: number;
  readonly y: number;
  private readonly sprite: HTMLImageElement;
  private readonly flip: HTMLElement;
  private readonly bubble: HTMLElement;
  private kind: Kind | null = null;
  private mood: Mood = 'ok';
  private running = false;
  private gen = 0;
  private emoteTimer: ReturnType<typeof setTimeout> | undefined;

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
      : ART.pets[this.group][Math.min(s.stage, ART.pets[this.group].length - 1)];
    if (this.sprite.getAttribute('src') !== src) this.sprite.src = src;
    const size = kind === 'pet' ? Math.round(PET_SIZE * petScale(s.stage)) : kind === 'egg' ? EGG_SIZE : GRAVE_SIZE;
    this.el.style.setProperty('--size', `${size}px`);
    this.el.dataset.kind = kind;
    this.el.dataset.mood = s.mood;
    this.mood = s.mood;
    if (kind === this.kind) return;
    const hatched = this.kind === 'egg' && kind === 'pet';
    this.kind = kind;
    this.halt();
    this.x = this.room.rect.cx;
    this.face(1);
    this.place();
    if (hatched) this.emote('joy', 2500);
    this.walkIfAllowed();
  }

  /** Движение разрешено, пока вкладка видна; без него питомец стоит на месте. */
  setRunning(on: boolean): void {
    if (on === this.running) return;
    this.running = on;
    if (on) this.walkIfAllowed();
    else this.halt();
  }

  emote(kind: Emote, ms = 1600): void {
    this.bubble.innerHTML = `<svg viewBox="0 0 40 40" aria-hidden="true">${EMOTE[kind]}</svg>`;
    this.bubble.classList.add('on');
    clearTimeout(this.emoteTimer);
    this.emoteTimer = setTimeout(() => this.bubble.classList.remove('on'), ms);
  }

  private walkIfAllowed(): void {
    if (this.running && this.kind === 'pet') void this.wander(++this.gen);
  }

  private halt(): void {
    this.gen++;
    this.el.classList.remove('walking');
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
        const nx = clamp(ball.x + dir * (90 + Math.random() * 90), 50, r.w - 50);
        ball.rot += (nx - ball.x) * 2.2;
        ball.x = nx;
        this.room.placeBall();
        if (this.mood === 'ok' && Math.random() < 0.5) this.emote('joy', 1300);
      } else if (!(await this.walkTo(r.x + EDGE + Math.random() * (r.w - 2 * EDGE), my))) {
        return;
      }
      if (!(await this.pause(500 + Math.random() * 1600, my))) return;
      const mood = MOOD_EMOTE[this.mood];
      if (mood && this.mood !== 'ok' && Math.random() < 0.5) this.emote(mood);
    }
  }

  private pause(ms: number, my: number): Promise<boolean> {
    return new Promise((resolve) => setTimeout(() => resolve(my === this.gen), ms));
  }

  /** Шаг по полу до `tx`; `false`, если цикл остановили. В фоне кадров нет — шаг всё равно заканчивается по таймеру. */
  private walkTo(tx: number, my: number): Promise<boolean> {
    const from = this.x;
    const d = Math.abs(tx - from);
    const ms = Math.max(250, d / (this.mood === 'sick' ? SICK_SPEED : SPEED));
    if (d > 3) this.face(tx < from ? -1 : 1);
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
        if (my !== this.gen) return finish(false);
        const k = Math.min(1, (now - t0) / ms);
        this.x = from + (tx - from) * ease(k);
        this.place();
        if (k < 1) requestAnimationFrame(step);
        else finish(true);
      };
      const safety = setTimeout(() => step(t0 + ms), ms + 150);
      requestAnimationFrame(step);
    });
  }

  private face(dir: 1 | -1): void {
    this.flip.style.transform = `scaleX(${dir})`;
  }

  private place(): void {
    const at = `translate(${this.x}px, ${this.y}px)`;
    this.el.style.transform = at;
    this.shadow.style.transform = at;
    this.el.style.zIndex = String(10 + Math.round(this.y));
    this.shadow.style.zIndex = String(9 + Math.round(this.y));
  }
}
