import { THEME } from '@/art/manifest';
import { GROUPS } from '@/engine/types';
import { pickBite } from './bite';
import { SPEED, type PetActor } from './PetActor';

/** В зале питомец крупнее: камера на общем плане отдалена. */
export const HALL_SCALE = 1.55;
/** Столько до конца прогулки все идут по домам; кто не дошёл к концу — сразу в комнате. */
export const HOME_MS = 6_000;
/** Места в зале на шестерых; первое — у героя праздника. */
const SPOTS: readonly (readonly [number, number])[] = [[1400, 1170], [1000, 1210], [1800, 1210], [1180, 1430], [1620, 1430], [1400, 1500]];
/** Нижний ряд выходит из комнаты вниз, под плинтус домика. */
const DOOR_Y = 1060;
const STAGGER_MS = 320;
const JUMP = 330;
/** Праздник у яйца: звезда и конфетти над ним раз в столько, пока праздник идёт. */
const CHEER_MS = 3_000;
const COLORS = GROUPS.map((g) => THEME[g].accent);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Прогулка и праздник в общем зале по макету: выход из комнат, встречи, визит к больному, мяч по кругу, возвращение.
 * Каждый питомец идёт по своему жетону (`PetActor.hold`): перехваченный (вылупился, погиб, вкладка скрылась)
 * выпадает из сценария, остальные продолжают. `stop()` возвращает всех по комнатам и убирает конфетти и мяч.
 */
export class Hall {
  private gen = 0;
  private out: PetActor[] = [];
  private homeTimer: ReturnType<typeof setTimeout> | undefined;
  private cheerTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly litter = new Set<HTMLElement>();
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly world: HTMLElement) {}

  /** `pets` выходят в зал на `ms`; `star` — герой праздника: выходит первым, прыгает под конфетти, остальные хлопают. */
  start(pets: PetActor[], ms: number, star?: PetActor): void {
    this.stop();
    const my = ++this.gen;
    const order = star ? [star, ...pets.filter((p) => p !== star)] : pets;
    this.out = order;
    const tokens = new Map(order.map((p) => [p, p.hold()]));
    this.homeTimer = setTimeout(() => void this.goHome(my), Math.max(0, ms - HOME_MS));
    void this.play(my, order, tokens, star);
  }

  /**
   * Праздник у того, кто не гуляет (яйцо): звезда и конфетти над ним в комнате все `ms`, а не один раз —
   * первый залп приходится на полёт камеры. Зал при этом пуст.
   */
  cheer(p: PetActor, ms: number): void {
    this.stop();
    const burst = (left: number) => {
      p.emote('star', CHEER_MS);
      this.confetti(p.x, p.y - 120);
      if (left > CHEER_MS) this.cheerTimer = setTimeout(() => burst(left - CHEER_MS), CHEER_MS);
    };
    burst(ms);
  }

  /** Конец кадра или отмена: кто не дошёл — сразу в своей комнате; конфетти и мяч убираются. */
  stop(): void {
    this.gen++;
    clearTimeout(this.homeTimer);
    clearTimeout(this.cheerTimer);
    this.out.forEach((p) => p.release());
    this.out = [];
    this.litter.forEach((n) => n.remove());
    this.litter.clear();
  }

  private async play(my: number, order: PetActor[], tokens: Map<PetActor, number>, star?: PetActor): Promise<void> {
    await Promise.all(order.map((p, k) => this.goOut(p, k, tokens.get(p)!)));
    if (my !== this.gen) return;
    if (star && star.owns(tokens.get(star)!)) await this.celebrate(my, star, order, tokens);
    if (my !== this.gen) return;
    await this.mingle(my, order.filter((p) => p.owns(tokens.get(p)!)), tokens, star);
  }

  private async goOut(p: PetActor, k: number, t: number): Promise<void> {
    await sleep(k * STAGGER_MS);
    const r = p.room.rect;
    const [sx, sy] = SPOTS[k % SPOTS.length];
    if (!(await p.walk(r.cx, r.floorY, t))) return;
    if (r.row === 0) await p.moveTo({ x: sx, y: sy, s: HALL_SCALE }, 1500, t, this.arc(JUMP));
    else if (await p.moveTo({ y: DOOR_Y, s: HALL_SCALE }, 700, t)) await p.walk(sx, sy, t, SPEED.hall);
  }

  private async celebrate(my: number, star: PetActor, order: PetActor[], tokens: Map<PetActor, number>): Promise<void> {
    const ts = tokens.get(star)!;
    for (let k = 0; k < 3 && my === this.gen; k++) {
      star.emote('star', 900);
      this.confetti(star.x, star.y - 200 * star.s);
      if (!(await star.moveTo({}, 520, ts, this.arc(90)))) break;
    }
    const fans = order.filter((p) => p !== star && p.owns(tokens.get(p)!));
    await Promise.all(fans.map(async (p, k) => {
      const ang = (Math.PI * k) / Math.max(1, fans.length - 1);
      if (!(await p.walk(star.x + Math.cos(ang) * 330, star.y + 50 + Math.sin(ang) * 150, tokens.get(p)!, SPEED.hall))) return;
      p.face(p.x < star.x ? 1 : -1);
      p.emote('smile');
    }));
    await sleep(1800);
  }

  private async mingle(my: number, live: PetActor[], tokens: Map<PetActor, number>, star?: PetActor): Promise<void> {
    const sick = live.find((p) => p.mood === 'sick');
    const others = live.filter((p) => p !== sick && p !== star);
    const pool = star && live.includes(star) ? [...others, star] : others;
    const pairs = [[pool[0], pool[1]], [pool[2], pool[3]]].filter((pair): pair is [PetActor, PetActor] => !!pair[0] && !!pair[1]);
    await Promise.all(pairs.map(([a, b]) => this.meet(a, b, tokens)));
    if (my !== this.gen) return;
    if (!star) await this.bite(live, tokens);
    if (my !== this.gen) return;
    if (sick) {
      sick.emote('sick', 2400);
      await Promise.all(others.slice(0, 2).map(async (p, k) => {
        if (!(await p.walk(sick.x + (k ? 170 : -170), sick.y + 10, tokens.get(p)!, SPEED.hall))) return;
        p.face(k ? -1 : 1);
        p.emote('joy', 2000);
      }));
      await sleep(2200);
      if (my !== this.gen) return;
      sick.emote('smile');
      await sleep(1400);
    }
    if (my !== this.gen) return;
    await this.passBall(my, live);
  }

  private async meet(a: PetActor, b: PetActor, tokens: Map<PetActor, number>): Promise<void> {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dir = a.x < b.x ? 1 : -1;
    const [okA, okB] = await Promise.all([
      a.walk(mx - dir * 115, my, tokens.get(a)!, SPEED.hall),
      b.walk(mx + dir * 115, my, tokens.get(b)!, SPEED.hall),
    ]);
    if (!okA || !okB) return;
    a.face(dir);
    b.face(dir === 1 ? -1 : 1);
    a.emote('smile');
    await sleep(500);
    b.emote('joy');
    await sleep(1300);
  }

  /**
   * «Кусь»: лидер по плану крадётся за спину отстающему и кусает («кусь»), либо отстающий лидера («догоню!»).
   * Жертва отвернулась от кусающего; укушенная подпрыгивает, пугается и отбегает. Кого перехватили — сцена обрывается.
   */
  private async bite(live: PetActor[], tokens: Map<PetActor, number>): Promise<void> {
    const bite = pickBite(live.map((p) => ({ id: p.group, plan: p.plan, sick: p.mood === 'sick' })), Math.random);
    const biter = live.find((p) => p.group === bite?.biter);
    const victim = live.find((p) => p.group === bite?.victim);
    if (!bite || !biter || !victim) return;
    const tb = tokens.get(biter)!;
    const tv = tokens.get(victim)!;
    const away = victim.x >= biter.x ? 1 : -1; // жертва смотрит от кусающего, тот заходит сзади
    victim.face(away);
    const behind = (gap: number) => victim.x - away * gap;
    if (!(await biter.walk(behind(280), victim.y, tb, SPEED.hall))) return;
    if (!(await biter.sneak(behind(140), victim.y, tb))) return;
    if (!(await biter.moveTo({ x: behind(80) }, 250, tb))) return;
    biter.say(bite.line, 1400);
    victim.emote('alert', 1400);
    const run = async () => {
      if (!(await victim.moveTo({}, 450, tv, this.arc(80)))) return;
      await victim.walk(victim.x + away * 150, victim.y, tv, SPEED.hall);
    };
    await Promise.all([run(), sleep(1400)]);
  }

  /** Мяч по кругу: от каждого к следующему. */
  private async passBall(my: number, ring: PetActor[]): Promise<void> {
    if (ring.length < 2) return;
    const ball = document.createElement('div');
    ball.className = 'hall-ball';
    ball.style.transform = `translate(${ring[0].x}px, ${ring[0].y - 60}px)`;
    this.world.append(ball);
    this.litter.add(ball);
    let rot = 0;
    for (let k = 0; k <= ring.length && my === this.gen; k++) {
      const p = ring[(k + 1) % ring.length];
      rot += 400;
      ball.style.transform = `translate(${p.x + p.facing * 70}px, ${p.y - 60}px) rotate(${rot}deg)`;
      await sleep(900);
    }
    ball.remove();
    this.litter.delete(ball);
  }

  /** Все по домам: верхний ряд прыжком, нижний через низ комнаты; дошедший снова бродит у себя. */
  private async goHome(my: number): Promise<void> {
    if (my !== this.gen) return;
    const home = ++this.gen;
    this.litter.forEach((n) => n.classList.contains('hall-ball') && n.remove());
    const pets = this.out;
    await Promise.all(pets.map(async (p, k) => {
      const t = p.hold();
      await sleep(k * 200);
      const r = p.room.rect;
      const atHome = p.s === 1 && p.y === r.floorY; // не успел выйти или его уже вернули
      const ok = atHome || (r.row === 0
        ? await p.moveTo({ x: r.cx, y: r.floorY, s: 1 }, 1500, t, this.arc(JUMP))
        : (await p.walk(r.cx, DOOR_Y, t, SPEED.hall)) && (await p.moveTo({ y: r.floorY, s: 1 }, 700, t)));
      if (!ok || home !== this.gen) return;
      this.out = this.out.filter((x) => x !== p);
      p.release();
    }));
  }

  private arc(h: number): number {
    return this.reduced ? 0 : h;
  }

  private confetti(x: number, y: number): void {
    if (this.reduced) return;
    for (let k = 0; k < 22; k++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.background = COLORS[k % COLORS.length];
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
      this.world.append(c);
      this.litter.add(c);
      const dx = (Math.random() - 0.5) * 520;
      const dy = -160 - Math.random() * 220;
      const gone = () => {
        c.remove();
        this.litter.delete(c);
      };
      c.animate([
        { transform: 'translate(0, 0) rotate(0)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${Math.random() * 720}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx * 1.3}px, ${dy + 420}px) rotate(${Math.random() * 1080}deg)`, opacity: 0 },
      ], { duration: 1600, easing: 'cubic-bezier(.2, .6, .4, 1)' }).onfinish = gone;
      // в скрытой вкладке анимация может не закончиться: конфетти всё равно уходит
      setTimeout(gone, 2000);
    }
  }
}
