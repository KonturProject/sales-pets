import { THEME } from '@/art/manifest';
import { GROUPS } from '@/engine/types';
import { pickBite } from './bite';
import {
  CHASE_LAPS, HALL, HALL_SCALE, KICKS, RUN, TIMING, TRAIN, ballSpot, ballWatch, gameMs, gamesFor, headingAt, homeLead,
  hopMs, kickSpot, leapDelay, leapPlan, loopPath, nearestOnLoop, pathLength, ringLoop, roamLeg, roamPoint, trainLoop,
  watchSpot, type Game, type LeapGroup, type Pt,
} from './hallGames';
import { SICK, SPEED, type PetActor } from './PetActor';

/** Столько до конца прогулки все идут по домам; кто не дошёл к концу — сразу в комнате. */
export const HOME_MS = 8_000;
/** Места в зале на шестерых (ноги в пределах `HALL`); первое — у героя праздника. */
const SPOTS: readonly (readonly [number, number])[] = [[1400, 1170], [1000, 1210], [1800, 1210], [1180, 1340], [1620, 1340], [1400, 1400]];
/** Нижний ряд выходит из комнаты вниз, под плинтус домика. */
const DOOR_Y = 1060;
const STAGGER_MS = 320;
const JUMP = 330;
/** Праздник у яйца: звезда и конфетти над ним раз в столько, пока праздник идёт. */
const CHEER_MS = 3_000;
const COLORS = GROUPS.map((g) => THEME[g].accent);
/** Брожение: после отрезка пауза `ROAM_PAUSE` + до 1 с. */
const ROAM_PAUSE = 500;
/** Укус: место встречи не ближе этого к краю зала по x — кусающему нужно место сзади, укушенному — впереди. */
const BITE_ROOM = 300;
/**
 * Больной смотрит на игры вне площадки (`watchSpot`); если оттуда после срока не дойти до двери своей комнаты за столько,
 * он идёт к ней заранее. Остальное время ухода домой — спуск в комнату (0,7 с), очередь (до 1 с) и запас.
 */
const HOME_WALK = HOME_MS - 3_000;
/** Визит: ближний гость выходит позже дальнего (чтобы дойти вместе), но ждёт не дольше этого. */
const VISIT_WAIT = 3_000;
/** Мяч: подскок пинающего на замахе, px; зрители встают в `BALL_WATCH`…+70 px от мяча; поворот мяча на 1 px пути, °. */
const KICK_HOP = 24;
const BALL_WATCH = 150;
const BALL_TURN = 360 / (Math.PI * 60);
/** Паровозик: шаг вагонов — средняя сторона картинок соседей × `HALL_SCALE` × `CAR_GAP`. */
const CAR_GAP = 1.1;
/** Разворот по ходу пути при сборе на игру: смотрим на столько px вперёд. */
const LOOK_AHEAD = 30;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const side = (dx: number): 1 | -1 => (dx < 0 ? -1 : 1);
const far = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Одна прогулка: её номер (`gen` при старте), жетоны гуляющих, срок (тогда все идут домой) и кто бродит с каким жетоном. */
interface Walk {
  my: number;
  tokens: Map<PetActor, number>;
  deadline: number;
  roaming: Map<PetActor, number>;
  /** Больные, что смотрят на игры (`watch`), — с жетоном наблюдения. */
  watching: Map<PetActor, number>;
}

/**
 * Прогулка и праздник в общем зале: выход из комнат, встречи, визит к больному, укус, догонялки и игры, возвращение.
 * У прогулки срок — за `HOME_MS` до конца: игра начинается, только если `gameMs` укладывается до него, а свободное время
 * здоровые бродят по залу. У каждого питомца в каждый момент один хозяин: сцена забирает участников (`take`, новый жетон
 * `PetActor.hold`), их брожение обрывается; остальные бродят. Перехваченный (вылупился, погиб, вкладка скрылась) выпадает,
 * остальные продолжают. `stop()` возвращает всех по комнатам и убирает конфетти и мяч.
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
    const w: Walk = { my, tokens: new Map(order.map((p) => [p, p.hold()])), deadline: Date.now() + ms - HOME_MS, roaming: new Map(), watching: new Map() };
    this.homeTimer = setTimeout(() => void this.goHome(my), Math.max(0, ms - HOME_MS));
    void this.play(w, order, star);
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
    delete this.world.dataset.hall;
  }

  /**
   * Прогулка: выход → встречи → визит к больному → укус → догонялки → игры `gamesFor` → брожение до срока.
   * Праздник (`star`): выход → поздравление → встречи → брожение, без укуса и игр.
   */
  private async play(w: Walk, order: PetActor[], star?: PetActor): Promise<void> {
    this.mark('out');
    await Promise.all(order.map(async (p, k) => {
      // вышедший бродит, пока выходят остальные; герой праздника ждёт на своём месте
      if ((await this.goOut(p, k, this.tok(w, p))) && p.mood !== 'sick' && p !== star) this.roam(w, [p]);
    }));
    if (!this.on(w)) return;
    if (star) await this.celebrate(w, star);
    if (!this.on(w)) return;
    await this.meetings(w, star);
    if (!star) {
      if (!this.on(w)) return;
      await this.visit(w);
      if (!this.on(w)) return;
      const bite = await this.bite(w);
      if (!this.on(w)) return;
      await this.game(w, 'chase', bite ?? []);
      for (const game of gamesFor(this.reduced, Math.random)) {
        if (!this.on(w)) return;
        await this.game(w, game);
      }
    }
    if (!this.on(w)) return;
    this.mark('roam');
    this.tend(w, !star);
    this.roam(w, this.healthy(w));
  }

  private async goOut(p: PetActor, k: number, t: number): Promise<boolean> {
    await sleep(k * STAGGER_MS);
    const r = p.room.rect;
    const [sx, sy] = SPOTS[k % SPOTS.length];
    if (!(await p.walk(r.cx, r.floorY, t))) return false;
    if (r.row === 0) return p.moveTo({ x: sx, y: sy, s: HALL_SCALE }, 1500, t, this.arc(JUMP));
    return (await p.moveTo({ y: DOOR_Y, s: HALL_SCALE }, 700, t)) && p.walk(sx, sy, t, SPEED.hall);
  }

  private async celebrate(w: Walk, star: PetActor): Promise<void> {
    const cast = this.cast(w, 'party', this.live(w));
    if (!cast.includes(star)) return;
    const ts = this.tok(w, star);
    for (let k = 0; k < 3 && this.on(w); k++) {
      star.emote('star', 900);
      this.confetti(star.x, star.y - 200 * star.s);
      if (!(await star.moveTo({}, 520, ts, this.arc(90)))) break;
    }
    const fans = cast.filter((p) => p !== star && p.owns(this.tok(w, p)));
    await Promise.all(fans.map(async (p, k) => {
      const ang = (Math.PI * k) / Math.max(1, fans.length - 1);
      const x = clamp(star.x + Math.cos(ang) * 330, HALL.x0, HALL.x1);
      const y = clamp(star.y + 50 + Math.sin(ang) * 150, HALL.y0, HALL.y1);
      if (!(await p.walk(x, y, this.tok(w, p), SPEED.hall))) return;
      p.face(p.x < star.x ? 1 : -1);
      p.emote('smile');
    }));
    await sleep(1800);
  }

  /** Встречи: до двух пар здоровых (на празднике герой — в паре); кому пары не досталось — бродят. */
  private async meetings(w: Walk, star?: PetActor): Promise<void> {
    const live = this.live(w);
    const others = live.filter((p) => p.mood !== 'sick' && p !== star);
    const pool = star && live.includes(star) ? [...others, star] : others;
    const pairs = [[pool[0], pool[1]], [pool[2], pool[3]]].filter((pair): pair is [PetActor, PetActor] => !!pair[0] && !!pair[1]);
    this.cast(w, 'meet', pairs.flat());
    await Promise.all(pairs.map(([a, b]) => this.meet(w, a, b)));
  }

  private async meet(w: Walk, a: PetActor, b: PetActor): Promise<void> {
    const mx = clamp((a.x + b.x) / 2, HALL.x0 + 115, HALL.x1 - 115);
    const my = (a.y + b.y) / 2;
    const dir = a.x < b.x ? 1 : -1;
    const [okA, okB] = await Promise.all([
      a.walk(mx - dir * 115, my, this.tok(w, a), SPEED.hall),
      b.walk(mx + dir * 115, my, this.tok(w, b), SPEED.hall),
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
   * Визит к больному: двое ближайших здоровых подходят с двух сторон (ближний выходит позже, доходят вместе) и радуются,
   * больной улыбается; остальные бродят. Потом больные уходят смотреть на игры или, если игр не будет, бродят (`tend`).
   */
  private async visit(w: Walk): Promise<void> {
    const sick = this.live(w).filter((p) => p.mood === 'sick');
    if (!sick.length) return;
    const [ill] = sick;
    const near = this.healthy(w).sort((a, b) => far(a, ill) - far(b, ill)).slice(0, 2);
    const guests = this.cast(w, 'visit', [ill, ...near]).filter((p) => p !== ill).sort((a, b) => a.x - b.x);
    if (guests.length) {
      ill.emote('sick', 2400);
      const spots = guests.map((p, k) => ({ x: ill.x + (guests.length === 2 ? (k ? 170 : -170) : side(p.x - ill.x) * 170), y: ill.y + 10 }));
      const ms = Math.max(1, ...guests.map((p, k) => far(p, spots[k]))) / SPEED.hall;
      await Promise.all(guests.map(async (p, k) => {
        await sleep(Math.min(VISIT_WAIT, ms - far(p, spots[k]) / SPEED.hall));
        if (!this.on(w) || !(await p.walk(spots[k].x, spots[k].y, this.tok(w, p), SPEED.hall))) return;
        p.face(side(ill.x - p.x));
        p.emote('joy', 2000);
      }));
      await sleep(2200);
      if (!this.on(w)) return;
      ill.emote('smile');
      await sleep(1400);
      if (!this.on(w)) return;
    }
    this.tend(w, true);
  }

  /**
   * Дело для больных: смотреть на игры (`watch`; бродивший уходит к краю, уже смотрящий остаётся), а если игр не будет
   * (праздник или здоровых меньше двух) — медленно бродить по залу (`roam`, `run` сам замедляет больного). Зовётся после
   * визита, перед каждой игрой и перед финальным брожением: заболевший посреди прогулки не остаётся стоять на поле.
   * Наблюдатели встают по очереди: ряд — сколько больных уже смотрят.
   */
  private tend(w: Walk, games: boolean): void {
    const watch = games && this.healthy(w).length >= 2;
    for (const p of this.live(w).filter((q) => q.mood === 'sick')) {
      if (!watch) this.roam(w, [p]);
      else if (w.watching.get(p) !== this.tok(w, p)) {
        void this.watch(w, p, this.live(w).filter((q) => w.watching.get(q) === this.tok(w, q)).length);
      }
    }
  }

  /**
   * Больной своим медленным шагом уходит за край игровой площадки со стороны своей комнаты (`watchSpot`) и смотрит на игры:
   * к центру, иногда градусник. Если оттуда домой после срока не успеть, к двери идёт заранее (`homeLead`). Прежний цикл
   * питомца (заболел посреди прогулки — бродил) обрывается (`take`); жетон записан как бродящий, чтобы брожение не
   * запустилось второй раз. Вылечили посреди прогулки — снова бродит.
   */
  private async watch(w: Walk, p: PetActor, k: number): Promise<void> {
    if (!this.take(w, [p]).length) return;
    const t = this.tok(w, p);
    w.roaming.set(p, t);
    w.watching.set(p, t);
    const r = p.room.rect;
    const spot = watchSpot(r.cx, k);
    const door = { x: r.cx, y: DOOR_Y };
    const leave = w.deadline - homeLead(spot, door, SPEED.hall * SICK, HOME_WALK);
    const watching = () => this.on(w) && p.owns(t) && p.mood === 'sick';
    if ((await p.run([spot], SPEED.hall, t)) && watching()) {
      p.face(side((HALL.x0 + HALL.x1) / 2 - spot.x));
      while (watching() && Date.now() < leave) {
        if (Math.random() < 0.5) p.emote('sick', 1800);
        await sleep(Math.min(3_000 + Math.random() * 2_000, Math.max(0, leave - Date.now())));
      }
      if (watching()) {
        await p.run([door], SPEED.hall, t); // от места наблюдения далеко домой: к двери до срока
        return;
      }
    }
    if (this.on(w) && p.owns(t) && p.mood !== 'sick') {
      w.roaming.delete(p);
      w.watching.delete(p);
      this.roam(w, [p]);
    }
  }

  /**
   * «Кусь»: лидер по плану крадётся за спину отстающему и кусает («кусь»), либо отстающий лидера («догоню!»).
   * Оба сходятся к середине между ними (жертва не ждёт долго); жертва отворачивается, укушенная подпрыгивает, пугается
   * и отбегает. Возвращает [кусачий, укушенный] для догонялок; кого перехватили — сцена обрывается (`null`).
   */
  private async bite(w: Walk): Promise<[PetActor, PetActor] | null> {
    const live = this.live(w);
    const bite = pickBite(live.map((p) => ({ id: p.group, plan: p.plan, sick: p.mood === 'sick' })), Math.random);
    const biter = live.find((p) => p.group === bite?.biter);
    const victim = live.find((p) => p.group === bite?.victim);
    if (!bite || !biter || !victim || this.cast(w, 'bite', [biter, victim]).length < 2) return null;
    const tb = this.tok(w, biter);
    const tv = this.tok(w, victim);
    const away = side(victim.x - biter.x); // жертва смотрит от кусающего, тот заходит сзади
    const at = { x: clamp((biter.x + victim.x) / 2, HALL.x0 + BITE_ROOM, HALL.x1 - BITE_ROOM), y: (biter.y + victim.y) / 2 };
    const behind = (gap: number) => at.x - away * gap;
    const [okV, okB] = await Promise.all([victim.walk(at.x, at.y, tv, SPEED.hall), biter.walk(behind(280), at.y, tb, SPEED.hall)]);
    if (!okV || !okB) return null;
    victim.face(away);
    if (!(await biter.sneak(behind(140), at.y, tb))) return null;
    if (!(await biter.moveTo({ x: behind(80) }, 250, tb))) return null;
    biter.say(bite.line, 1400);
    victim.emote('alert', 1400);
    const flee = async () => {
      if (!(await victim.moveTo({}, 450, tv, this.arc(80)))) return;
      await victim.walk(victim.x + away * 150, victim.y, tv, SPEED.hall);
    };
    await Promise.all([flee(), sleep(1400)]);
    return [biter, victim];
  }

  /**
   * Игра `game` для всех здоровых, если она укладывается до срока и их не меньше двух (иначе пропускается); `first` —
   * впереди (догонялки: кусачий, за ним укушенный). Участники забираются у брожения; больные — к краю (`tend`).
   */
  private async game(w: Walk, game: Game, first: PetActor[] = []): Promise<void> {
    if (this.on(w)) this.tend(w, true);
    const kids = this.healthy(w);
    if (!this.on(w) || Date.now() + gameMs(game, kids.map((p) => p.size)) > w.deadline) return;
    const lead = first.filter((p) => kids.includes(p));
    const team = this.cast(w, game, [...lead, ...kids.filter((p) => !lead.includes(p))]);
    if (team.length < 2) return;
    if (game === 'chase') await this.chase(w, team);
    else if (game === 'ball') await this.ball(w, team);
    else if (game === 'train') await this.train(w, team);
    else await this.leap(w, team);
  }

  /** Догонялки: на кольце через равные доли периметра, первый — у ближайшего к нему места; два круга бегом, все радуются. */
  private async chase(w: Walk, team: PetActor[]): Promise<void> {
    const ring = ringLoop();
    const per = pathLength(ring);
    const from = nearestOnLoop(ring, team[0]);
    const laps = team.map((_, k) => loopPath(ring, from - (k * per) / team.length, CHASE_LAPS * per));
    const ready = await this.lineUp(w, team, laps);
    if (!this.on(w)) return;
    await Promise.all(team.map((p, k) => ready[k] && p.run(laps[k], RUN, this.tok(w, p))));
    await this.rejoice(w, team);
  }

  /**
   * Мяч: появляется у ног случайного игрока, тот пинает от себя. Пока мяч катится, все бегут к нему: ближайший к месту
   * пинка встаёт вплотную — с той стороны, чтобы следующий пинок унёс мяч от него (без остановки: не быстрее бега и не
   * раньше, чем мяч докатится),
   * остальные — вокруг (`ballWatch`), лицом к мячу; следующий пинок их перебивает. После `KICKS` пинков мяч тает, все
   * радуются. Пинок, который не успеть до срока, не начинается.
   */
  private async ball(w: Walk, team: PetActor[]): Promise<void> {
    let kicker = team[Math.floor(Math.random() * team.length)];
    let to = ballSpot(kicker, Math.random);
    const dir0 = side(to.x - kicker.x);
    let at = kickSpot(kicker, dir0 === 1 ? -1 : 1, kicker.size); // мяч у ног, со стороны пинка (зеркально месту пинающего)
    kicker.face(dir0);
    const ball = this.newBall(at);
    let rot = 0;
    for (let k = 0; k < KICKS; k++) {
      if (Date.now() + TIMING.kick + TIMING.roll + TIMING.joy > w.deadline) break;
      if (!(await kicker.moveTo({}, TIMING.kick, this.tok(w, kicker), this.arc(KICK_HOP))) || !this.on(w)) break;
      rot += (to.x - at.x) * BALL_TURN;
      at = to;
      this.putBall(ball, at, rot);
      to = ballSpot(at, Math.random);
      const dir = side(to.x - at.x);
      const players = this.take(w, team);
      let next: PetActor | undefined;
      for (const p of players) if (!next || far(p, kickSpot(at, dir, p.size)) < far(next, kickSpot(at, dir, next.size))) next = p;
      if (!next) break;
      const spot = kickSpot(at, dir, next.size);
      const ms = far(next, spot) / RUN;
      if (Date.now() + Math.max(ms, TIMING.roll) + TIMING.joy > w.deadline) {
        await sleep(TIMING.roll);
        break;
      }
      for (const p of players) if (p !== next) void this.watchBall(w, p, at, dir);
      const speed = Math.min(RUN, Math.max(SPEED.hall / 4, far(next, spot) / TIMING.roll));
      if (!this.on(w) || !(await next.run([spot], speed, this.tok(w, next)))) break;
      next.face(dir);
      kicker = next;
    }
    if (!this.on(w)) return;
    this.take(w, team);
    ball.style.opacity = '0';
    setTimeout(() => {
      ball.remove();
      this.litter.delete(ball);
    }, 300);
    await this.rejoice(w, team);
  }

  /** Зритель бежит к мячу и встаёт рядом, лицом к нему. */
  private async watchBall(w: Walk, p: PetActor, at: Pt, dir: 1 | -1): Promise<void> {
    if (await p.run([ballWatch(p, at, dir, BALL_WATCH + Math.random() * 70)], RUN, this.tok(w, p))) p.face(side(at.x - p.x));
  }

  /** Паровозик: ведущий («ту-ту!») и цепочка за ним (ближние первыми) на петле-змейке, один круг шагом `TRAIN`. */
  private async train(w: Walk, team: PetActor[]): Promise<void> {
    const lead = team[Math.floor(Math.random() * team.length)];
    const cars = [lead, ...team.filter((p) => p !== lead).sort((a, b) => far(a, lead) - far(b, lead))];
    const loop = trainLoop();
    const per = pathLength(loop);
    let from = nearestOnLoop(loop, lead);
    const laps = cars.map((p, k) => {
      if (k) from -= ((cars[k - 1].size + p.size) / 2) * HALL_SCALE * CAR_GAP;
      return loopPath(loop, from, per);
    });
    const ready = await this.lineUp(w, cars, laps);
    if (!this.on(w)) return;
    if (ready[0]) lead.say('ту-ту!', 1400);
    await Promise.all(cars.map((p, k) => ready[k] && p.run(laps[k], TRAIN, this.tok(w, p))));
    await this.rejoice(w, [lead]);
  }

  /**
   * Чехарда по `leapPlan`: все бегом встают на старт, потом группы прыгают каждая на своей дорожке, вразнобой
   * (`leapDelay`). Закончившая группа радуется и бродит, пока прыгают остальные.
   */
  private async leap(w: Walk, team: PetActor[]): Promise<void> {
    const plan = leapPlan(team.map((p) => p.size), HALL_SCALE);
    const start = new Map<PetActor, Pt>();
    plan.forEach((g) => g.members.forEach((m, k) => start.set(team[m], g.start[k])));
    await Promise.all(team.map((p) => p.run([start.get(p)!], RUN, this.tok(w, p))));
    if (!this.on(w)) return;
    team.filter((p) => p.owns(this.tok(w, p))).forEach((p) => p.face(1));
    await Promise.all(plan.map((g, i) => this.leapGroup(w, team, g, leapDelay(i, plan.length))));
  }

  /** Прыжки группы: перепрыгиваемые приседают (`TIMING.crouch`), задний перелетает их дугой, выше них по глубине. */
  private async leapGroup(w: Walk, team: PetActor[], g: LeapGroup, delay: number): Promise<void> {
    await sleep(delay);
    const ms = hopMs(g);
    for (const hop of g.hops) {
      if (!this.on(w) || Date.now() + TIMING.crouch + ms + TIMING.joy > w.deadline) break;
      const who = team[hop.who];
      const under = g.members.filter((m) => m !== hop.who).map((m) => team[m]).filter((p) => p.owns(this.tok(w, p)));
      under.forEach((p) => p.crouch(true));
      await sleep(TIMING.crouch);
      const ok = this.on(w) && (await who.moveTo(hop.to, ms, this.tok(w, who), this.arc(hop.arc)));
      under.forEach((p) => p.crouch(false));
      if (!ok) break;
    }
    const kids = g.members.map((m) => team[m]);
    await this.rejoice(w, kids);
    if (this.on(w)) this.roam(w, kids);
  }

  /** Сбор на игру: каждый бегом к началу своего пути и разворачивается по ходу; ждём всех. `true` — встал на место. */
  private lineUp(w: Walk, pets: PetActor[], paths: Pt[][]): Promise<boolean[]> {
    return Promise.all(pets.map(async (p, k) => {
      if (!(await p.run([paths[k][0]], RUN, this.tok(w, p)))) return false;
      const dir = headingAt(paths[k], LOOK_AHEAD);
      if (dir) p.face(dir);
      return true;
    }));
  }

  /** Конец игры: `pets` (кто ещё в игре) радуются; ждём, пока радость не кончится. */
  private async rejoice(w: Walk, pets: PetActor[]): Promise<void> {
    if (!this.on(w)) return;
    pets.filter((p) => p.owns(this.tok(w, p))).forEach((p) => p.joy());
    await sleep(TIMING.joy);
  }

  /** Брожение: каждый из `pets` бродит, пока его не заберёт сцена или не наступит срок; уже бродящий продолжает своё. */
  private roam(w: Walk, pets: PetActor[]): void {
    for (const p of pets) {
      const t = w.tokens.get(p);
      if (t === undefined || !p.owns(t) || w.roaming.get(p) === t) continue;
      w.roaming.set(p, t);
      void this.wander(w, p, t);
    }
  }

  /**
   * Отрезки брожения: к `roamPoint` бегом шага зала (`SPEED.hall`), пауза 0,5–1,5 с, изредка улыбка или сердечко.
   * Отрезок с паузой кончается до срока: последний короче и с короткой паузой; когда времени нет — стоит до срока.
   */
  private async wander(w: Walk, p: PetActor, t: number): Promise<void> {
    while (this.on(w) && p.owns(t)) {
      const left = w.deadline - Date.now();
      const to = roamPoint(Math.random);
      let pause = ROAM_PAUSE + Math.random() * 1_000;
      if (far(p, to) / SPEED.hall + pause > left) pause = ROAM_PAUSE;
      const leg = roamLeg(p, to, left - pause, SPEED.hall);
      if (!leg || !(await p.run([leg], SPEED.hall, t))) return;
      if (Math.random() < 0.25) p.emote(Math.random() < 0.5 ? 'smile' : 'joy', 1300);
      await sleep(pause);
    }
  }

  /** Все по домам: верхний ряд прыжком, нижний через низ комнаты; дошедший снова бродит у себя. */
  private async goHome(my: number): Promise<void> {
    if (my !== this.gen) return;
    const home = ++this.gen;
    this.mark('home');
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

  private on(w: Walk): boolean {
    return w.my === this.gen;
  }

  private tok(w: Walk, p: PetActor): number {
    return w.tokens.get(p)!;
  }

  /** Кто ещё гуляет: свой жетон не перехвачен. */
  private live(w: Walk): PetActor[] {
    return [...w.tokens].filter(([p, t]) => p.owns(t)).map(([p]) => p);
  }

  private healthy(w: Walk): PetActor[] {
    return this.live(w).filter((p) => p.mood !== 'sick');
  }

  /**
   * Забрать питомцев (у брожения или прошлой сцены): шаг обрывается на месте, у питомца новый жетон. Перехваченный
   * (вылупился, погиб, вкладку скрыли) и все после конца прогулки не забираются — их жетон уже не их.
   */
  private take(w: Walk, pets: PetActor[]): PetActor[] {
    if (!this.on(w)) return [];
    return pets.filter((p) => {
      if (!p.owns(this.tok(w, p))) return false;
      w.tokens.set(p, p.hold());
      return true;
    });
  }

  /** Начало сцены `name`: её участники забираются, остальные здоровые бродят (больной стоит или смотрит с края). */
  private cast(w: Walk, name: string, pets: PetActor[]): PetActor[] {
    const got = this.take(w, pets);
    if (!this.on(w)) return got;
    this.mark(name);
    this.roam(w, this.healthy(w).filter((p) => !got.includes(p)));
    return got;
  }

  /** Что сейчас в зале (`data-hall` на мире): для замеров и проверок. */
  private mark(name: string): void {
    this.world.dataset.hall = name;
  }

  private newBall(at: Pt): HTMLElement {
    const ball = document.createElement('div');
    ball.className = 'hall-ball';
    ball.style.opacity = '0';
    this.putBall(ball, at, 0);
    this.world.append(ball);
    this.litter.add(ball);
    setTimeout(() => (ball.style.opacity = ''), 30); // появляется плавно (переход opacity в tv.css)
    return ball;
  }

  /**
   * Мяч катится к `at` (переход transform в tv.css). По глубине на время проката — ближняя к зрителю из старой и новой
   * точки, по приезде — как питомец, стоящий там же.
   */
  private putBall(ball: HTMLElement, at: Pt, rot: number): void {
    const z = String(10 + Math.round(at.y));
    ball.style.transform = `translate(${at.x}px, ${at.y - 60}px) rotate(${rot}deg)`;
    ball.style.zIndex = String(Math.max(Number(z), Number(ball.style.zIndex) || 0));
    ball.dataset.z = z;
    setTimeout(() => {
      if (ball.dataset.z === z) ball.style.zIndex = z;
    }, TIMING.roll);
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
