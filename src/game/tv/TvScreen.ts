import './tv.css';
import type { Config } from '@/engine/config';
import type { PetState } from '@/engine/pet';
import type { RankData } from '@/engine/ranking';
import { THEME } from '@/art/manifest';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import type { PowerMode } from '@/game/PowerSaver';
import { mountRanking, short } from '@/game/RankingPanel';
import { PLANTS } from './art';
import { dayRoomMs, daySteps, enqueueDay, staleDay, type DayEventPlan, type RoomEvent } from './dayEvent';
import { Hall } from './Hall';
import { BOARDS, CAMERA, roomCamera, roomRect, STAGE } from './layout';
import { dayLine, groupFunnel, partyBanner, paymentGains, type FunnelTotal } from './metrics';
import { careRooms, growthMoments, MAX_MOMENTS, type RoomMoment } from './moments';
import { PetActor } from './PetActor';
import { CRATE_LAND_MS, HAND_MS, RoomView, TOY_LAND_MS } from './RoomView';
import { careTurn, shotAt, walkFor, type Shot } from './schedule';
import { toyForRoom, type ToyKind } from './toys';

export interface TvOptions {
  states: () => Record<GroupCode, PetState>;
  asOf: () => DateStr;
  /** настройки на `asOf`: календарь для строки «день N из 14» */
  cfg: () => Config;
  /** данные рейтингов; без них (демо) доски пустые */
  rank?: () => RankData;
  /** строка свежести данных справа вверху */
  fresh?: () => string;
  /** игрушка дня групп (последний расход игрушки РГ за сегодня); без неё (демо) в комнатах мячи */
  toys?: () => Record<GroupCode, { id: number; kind: ToyKind } | null>;
}

export interface Tv {
  update(): void;
  playHand(group: GroupCode, item: 'medkit' | 'toy'): void;
  /** Событие «итоги дня»: комнаты по очереди крупно, с плашкой и анимацией «было → стало» (`dayEvent.ts`). */
  playDay(plan: DayEventPlan): void;
  setPower(mode: PowerMode): void;
}

/** Табло комнат меняет цифру раз в столько тиков (тик — 1 с). */
const TICKER_EVERY = 3;
/** Слайды правой доски: шесть групп и «Топ-10». */
const SLIDES = GROUPS.length + 1;
/** Праздник новой оплаты длится столько. */
const PARTY_MS = 20_000;
/** Прогулка — только когда в зале есть с кем встретиться. */
const MIN_WALKERS = 2;
/** Выбор на нижней панели держит камеру у доски столько, потом цикл продолжается. */
const HOLD_MS = 15_000;
/** Крупный план при вылуплении или росте держится столько. */
const MOMENT_MS = 8_000;
/** Событие «итоги дня»: анимации комнаты начинаются, когда камера долетела (переход мира в событии — 1,6 с, `tv.css`). */
const DAY_ACT_MS = 1_500;
/** Переезд камеры в событии (`transition-duration` у `.tv[data-day] .tv-world`): плашка новой комнаты — по приезде. */
const DAY_PAN_MS = 1_600;
/** Ящики одной комнаты падают через столько, мс. */
const DAY_CRATE_GAP_MS = 850;
/**
 * Питомец тужится правее места новой кучки на столько px (кучка — позади него) и бежит туда не дольше `HURRY_MS`.
 * Питомец крупнее `STRAIN_SIZE` px встаёт дальше в той же пропорции: иначе его нога закрывает «пум!».
 */
const STRAIN_AT = 58;
const STRAIN_SIZE = 120;
const HURRY_MS = 900;
/** Пока падают ящики, питомец стоит левее этого места комнаты, px: не заслоняет ящики запасов справа. */
const CLEAR_X = 300;

/** Комната события в очереди; `at` — когда поставлена (для снятия после долгого `idle`). */
interface DayRoom extends RoomEvent { at: number }

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const div = (cls: string, text?: string) => {
  const node = document.createElement('div');
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (text: string, onClick: () => void) => {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = text;
  node.addEventListener('click', onClick);
  return node;
};

const plant = (side: 'left' | 'right') => {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg class="fg ${side}" viewBox="0 0 300 360" aria-hidden="true">${PLANTS[side]}</svg>`;
  return wrap.firstElementChild!;
};

/**
 * Экран ТВ: сцена 1920×1080, вписанная в окно; мир — зал с досками рейтингов и домик из шести комнат.
 * Камера всегда автоматическая: цикл `shotAt` с прогулкой в зале; ввод и фокус вкладки кадр не меняют (режим `active`
 * только ускоряет анимации), вкладка скрыта (`idle`) — всё стоит. Новая оплата группы — праздник на общем плане
 * (`data-party`), потом цикл с начала. Нижняя панель (`.dock`) выбирает группу, «Топ-10» и день героев: камера
 * едет к доске и держит её `HOLD_MS`.
 */
export function mountTv(root: HTMLElement, o: TvOptions): Tv {
  const world = div('tv-world');
  world.append(div('h-wall'), div('h-wainscot'), div('h-floor'), div('h-rug'), div('h-plinth'));

  const heroesBoard = div('board');
  heroesBoard.dataset.board = 'heroes';
  const groupBoard = div('board');
  groupBoard.dataset.board = 'group';
  groupBoard.dataset.slide = 'group';
  for (const [board, at] of [[heroesBoard, BOARDS.heroes], [groupBoard, BOARDS.group]] as const) {
    board.style.left = `${at.x}px`;
    board.style.top = `${at.y}px`;
  }

  const rooms = GROUPS.map((g, i) => new RoomView(g, i, roomRect(i)));
  const pets = rooms.map((r) => new PetActor(r.group, r));
  const house = div('house');
  house.append(...rooms.map((r) => r.el));
  world.append(heroesBoard, groupBoard, house, ...pets.flatMap((p) => [p.shadow, p.el]));
  const hall = new Hall(world);

  const day = document.createElement('span');
  const title = div('hud-title');
  const name = document.createElement('b');
  name.textContent = 'Питомцы отделов продаж';
  title.append(name, ' · ', day);
  const fresh = div('hud-fresh');
  const hud = div('hud');
  hud.append(title, fresh);
  const banner = div('banner');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stage = div('tv-stage');
  stage.append(world, plant('left'), plant('right'), hud, banner);
  const fit = div('tv-fit');
  fit.append(stage);
  const screen = div('tv');
  screen.append(fit);
  root.replaceChildren(screen);

  const ranking = o.rank ? mountRanking(o.rank, { asOf: o.asOf }) : null;
  /** выбор на нижней панели: камера держит эту доску до `until`, листание её не перебивает */
  let hold: { shot: 'heroes' | 'group'; until: number } | null = null;
  const holdOn = (shot: 'heroes' | 'group') => {
    hold = { shot, until: Date.now() + HOLD_MS };
    camera();
  };
  /** выбор зрителя живёт, пока длится удержание (праздник его прерывает): дальше у героев снова день по умолчанию */
  const dropHold = () => {
    if (!hold) return;
    hold = null;
    ranking?.resetDay();
    syncDock();
  };
  const dock = div('dock');
  const dayLabel = document.createElement('b');
  const dayPrev = button('‹', () => { ranking?.stepDay(-1); syncDock(); holdOn('heroes'); });
  const dayNext = button('›', () => { ranking?.stepDay(1); syncDock(); holdOn('heroes'); });
  dayPrev.setAttribute('aria-label', 'Предыдущий день');
  dayNext.setAttribute('aria-label', 'Следующий день');
  const days = div('dock-days');
  days.append(div('dock-label', 'Герои дня'), dayPrev, dayLabel, dayNext);
  const picks = div('dock-groups');
  for (const g of [...GROUPS, 'top'] as const) {
    const b = button(g === 'top' ? 'Топ-10' : g, () => {
      if (g !== 'top') ranking?.pickGroup(g);
      showSlide(g === 'top' ? 'top' : 'group');
      holdOn('group');
    });
    b.dataset.pick = g;
    if (g !== 'top') b.style.setProperty('--accent', THEME[g].accent);
    picks.append(b);
  }
  dock.append(days, picks);
  /** нижняя панель показывает то, что сейчас на досках, в том числе при листании на стене */
  function syncDock(): void {
    if (!ranking) return;
    const { group, day, days: list } = ranking.picked();
    const on = groupBoard.dataset.slide === 'top' ? 'top' : group;
    for (const b of picks.children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.pick === on));
    dayLabel.textContent = day ? short(day) : '—';
    dayPrev.disabled = !list.length || day === list[0];
    dayNext.disabled = !list.length || day === list[list.length - 1];
  }

  if (ranking) {
    heroesBoard.append(ranking.blocks.heroes);
    groupBoard.append(ranking.blocks.group, ranking.blocks.top);
    stage.append(dock);
  } else {
    heroesBoard.append(div('board-empty', 'Герои дня появятся с первыми данными'));
    groupBoard.append(div('board-empty', 'Рейтинги появятся с первыми данными'));
  }

  function showSlide(slide: 'group' | 'top'): void {
    groupBoard.dataset.slide = slide;
    syncDock();
  }
  showSlide('group');

  const doFit = () => {
    const s = Math.min(innerWidth / STAGE.w, innerHeight / STAGE.h);
    fit.style.transform = `translate(${(innerWidth - STAGE.w * s) / 2}px, ${(innerHeight - STAGE.h * s) / 2}px) scale(${s})`;
  };
  addEventListener('resize', doFit);
  doFit();

  let shot: string | null = null;
  /** Кадр камеры; `room` — крупный план комнаты `focus` (номер в `GROUPS`). Возвращает, сменился ли кадр. */
  const setShot = (next: Shot | 'room', animate = true, focus = -1): boolean => {
    const key = next === 'room' ? `room:${focus}` : next;
    if (key === shot) return false;
    shot = key;
    screen.dataset.shot = next;
    if (next === 'room') screen.dataset.focus = GROUPS[focus];
    else delete screen.dataset.focus;
    if (!animate) world.style.transition = 'none';
    const c = next === 'room' ? roomCamera(focus) : null;
    world.style.transform = c ? `translate(${c.x}px, ${c.y}px) scale(${c.s})` : CAMERA[next as Shot];
    if (!animate) {
      void world.offsetWidth;
      world.style.transition = '';
    }
    return true;
  };
  setShot('overview', false);

  /** плашка комнаты события, отложенная до приезда камеры (`focusRoom`); любая другая плашка её отменяет */
  let plate: ReturnType<typeof setTimeout> | undefined;
  /** `day` — плашка итогов дня: код группы и дата цветом группы, при смене комнаты плашка вздрагивает. */
  const showBanner = (text: string | null, day?: GroupCode) => {
    clearTimeout(plate);
    plate = undefined;
    if (text !== null && banner.textContent !== text) {
      const was = banner.classList.contains('on');
      banner.classList.toggle('day', !!day);
      if (day) {
        const cut = text.indexOf(':');
        const head = document.createElement('b');
        head.textContent = cut < 0 ? text : text.slice(0, cut);
        banner.style.setProperty('--accent', THEME[day].accent);
        banner.replaceChildren(head, cut < 0 ? '' : text.slice(cut));
        if (was && !reduced) banner.animate([{ translate: '0 14px', opacity: 0.3 }, { translate: '0 0', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.3, 1.5, .5, 1)' });
      } else banner.textContent = text;
    }
    banner.classList.toggle('on', text !== null);
    screen.toggleAttribute('data-banner', text !== null); // плашка внизу: нижняя панель на это время уезжает
  };
  const walkers = () => pets.filter((p) => p.walker);

  let walking = false;
  const endWalk = () => {
    if (!walking) return;
    walking = false;
    hall.stop();
    showBanner(null);
  };

  let power: PowerMode | null = null;
  let cycleStart = 0;
  let partyUntil: number | null = null;
  let loop: ReturnType<typeof setInterval> | undefined;
  let ticks = 0;
  /** важные моменты (вылупление, рост) ждут очереди; `moment` — показываемый сейчас */
  let moments: RoomMoment[] = [];
  let moment: (RoomMoment & { until: number }) | null = null;
  let states: Record<GroupCode, PetState> | null = null;
  let totals: Record<GroupCode, FunnelTotal> | undefined;
  let roomBanner = false;

  /**
   * Событие «итоги дня»: комнаты ждут в `dayQueue`, `turn` — показываемая. Видимое комнаты (`held`) — «было», пока не
   * пройдёт её очередь; `data-*` всегда настоящие. Время на комнату — `dayRoomMs` (вся очередь ≤ 45 с).
   */
  let dayQueue: DayRoom[] = [];
  let turn: { room: DayRoom; i: number; until: number } | null = null;
  let dayMs = dayRoomMs(1);
  let dayTimer: ReturnType<typeof setTimeout> | undefined;
  let actTimer: ReturnType<typeof setTimeout> | undefined;
  const held = new Map<GroupCode, PetState>();
  let idleSince: number | null = null;

  /** Комната и питомец по состоянию: видимое — придержанное событием, если есть; `pop` — новые кучки «пум» (`actDay`). */
  const paint = (i: number, pop = false) => {
    if (!states) return;
    const g = GROUPS[i];
    const was = held.get(g);
    // событие придерживает только то, что оно показывает (кучки, аптечки, игрушки); оплаты, стадия, настроение — живые
    const shown = was && { ...states[g], piles: was.piles, medkits: was.medkits, toys: was.toys };
    rooms[i].update(states[g], totals?.[g], shown, pop);
    pets[i].update(shown ?? states[g]);
  };

  /**
   * Крупный план комнаты с плашкой; `null` — убрать плашку крупного плана. Из зала питомец сразу дома. Плашка итогов дня
   * (`day`) меняется, когда камера доехала: пока она едет, на экране ещё прошлая комната.
   */
  const focusRoom = (m: RoomMoment | null, day = false) => {
    if (!m) {
      if (roomBanner) showBanner(null);
      roomBanner = false;
      return;
    }
    endWalk();
    const i = GROUPS.indexOf(m.group);
    if (setShot('room', true, i)) {
      pets[i].release();
      if (day && !reduced) {
        clearTimeout(plate);
        plate = setTimeout(() => {
          plate = undefined;
          if (turn?.room === m) showBanner(m.text, m.group);
        }, DAY_PAN_MS);
      }
    }
    roomBanner = true;
    if (plate === undefined) showBanner(m.text, day ? m.group : undefined);
  };

  /** Очередь комнаты закончилась: видимое — настоящее (или «было» её следующей записи в очереди). */
  const endTurn = () => {
    const { room, i } = turn!;
    turn = null;
    clearTimeout(actTimer);
    const again = dayQueue.find((q) => q.group === room.group);
    if (again) held.set(room.group, again.from);
    else held.delete(room.group);
    paint(i);
    if (!dayQueue.length) delete screen.dataset.day;
  };

  /**
   * Праздник, выбор на панели или режим экономии перебили событие: показываемая комната снова ждёт первой в очереди, с
   * того, что уже видно на экране. Начатая анимация бросается (`actDay`) и, когда очередь вернётся, играет оставшееся.
   */
  const pauseDay = () => {
    clearTimeout(dayTimer);
    clearTimeout(plate);
    plate = undefined;
    if (!turn) return;
    clearTimeout(actTimer);
    dayQueue.unshift({ ...turn.room, from: held.get(turn.room.group) ?? turn.room.from });
    turn = null;
  };

  /** Камера в событии: следующая комната по очереди; `false` — события нет. */
  const dayCamera = (now: number): boolean => {
    if (turn && now >= turn.until) endTurn();
    if (!turn && dayQueue.length) {
      const room = dayQueue.shift()!;
      if (moment) {
        moments.unshift({ group: moment.group, text: moment.text }); // рост — после итогов
        moment = null;
      }
      const me = { room, i: GROUPS.indexOf(room.group), until: now + dayMs };
      turn = me;
      screen.dataset.day = '';
      actTimer = setTimeout(() => {
        if (turn === me) void actDay(me);
      }, reduced ? 0 : DAY_ACT_MS);
    }
    if (!turn) return false;
    focusRoom(turn.room, true);
    clearTimeout(dayTimer);
    dayTimer = setTimeout(camera, turn.until - now);
    return true;
  };

  /**
   * Анимации комнаты по разнице «было → стало» (`daySteps`): кучка — питомец бежит к её месту, отворачивается, тужится,
   * «пум», отскакивает и оглядывается; убранная кучка — облачко; аптечки и игрушки — ящики сверху в ящики запасов, питомец
   * отходит, смотрит и радуется. Видимое меняется, только пока это её очередь; при reduced motion — сразу конечное.
   * Очередь перебили (`pauseDay`) — после любого ожидания анимация бросается, питомец (если ещё её) идёт бродить.
   */
  async function actDay(me: NonNullable<typeof turn>): Promise<void> {
    const { room, i } = me;
    const r = rooms[i];
    const p = pets[i];
    let shown = held.get(room.group) ?? room.from;
    const show = (next: PetState) => {
      shown = next;
      if (turn !== me) return;
      held.set(room.group, next);
      paint(i, true);
    };
    if (reduced) return show(room.to);
    const token = p.hold();
    const walker = p.walker;
    const mine = () => p.owns(token);
    const gone = () => {
      if (turn === me) return false;
      if (mine()) p.release();
      return true;
    };
    const hurry = (x: number) => p.moveTo({ x }, Math.min(HURRY_MS, Math.max(250, Math.abs(x - p.x) / 0.3)), token);
    let crates = 0;
    for (const step of daySteps(shown, room.to)) {
      if (gone()) return;
      if (step === 'pile') {
        if (walker && mine()) {
          await hurry(r.nextPileX() + STRAIN_AT * Math.max(1, p.size / STRAIN_SIZE));
          if (gone()) return;
          p.face(1); // спиной к месту кучки
          await wait(260);
          if (gone()) return;
        }
        if (mine()) await p.strain();
        if (gone()) return;
        show({ ...shown, piles: room.to.piles });
        if (walker && mine()) {
          await p.moveTo({ x: p.x + 34 }, 380, token, 26); // отдача: отскок вперёд, кучка видна
          if (gone()) return;
          await wait(280);
          if (gone()) return;
          if (mine()) p.face(-1); // оглянулся на кучку
          await wait(650);
        }
      } else if (step === 'poof') {
        r.poofPile();
        show({ ...shown, piles: shown.piles - 1 });
        await wait(800);
      } else {
        if (!crates && walker && mine() && p.x > r.rect.x + CLEAR_X) {
          await hurry(r.rect.x + CLEAR_X - 60);
          if (gone()) return;
        }
        if (walker && mine()) p.face(1); // смотрит на ящики запасов
        crates++;
        const kind = step === 'medkit' ? 'medkits' : 'toys';
        show({ ...shown, [kind]: shown[kind] + 1 });
        r.dropCrate(kind);
        await wait(DAY_CRATE_GAP_MS);
      }
    }
    if (crates) await wait(Math.max(0, CRATE_LAND_MS + 100 - DAY_CRATE_GAP_MS));
    if (gone()) return;
    show(room.to);
    if (!mine()) return;
    p.release();
    if (crates) p.cheer();
  }

  /** Событие прождало в `idle` дольше 15 мин — снимается: в комнатах сразу текущие числа. */
  const expireDay = (since: number) => {
    const now = Date.now();
    dayQueue = dayQueue.filter((q) => !staleDay(q.at, since, now));
    if (turn && staleDay(turn.room.at, since, now)) endTurn();
    for (const g of [...held.keys()]) if (turn?.room.group !== g && !dayQueue.some((q) => q.group === g)) held.delete(g);
    GROUPS.forEach((_, i) => paint(i));
    if (!turn && !dayQueue.length) delete screen.dataset.day;
  };
  function camera(): void {
    if (power === null || power === 'idle' || partyUntil !== null) return pauseDay();
    const now = Date.now();
    if (hold && now < hold.until) {
      pauseDay();
      endWalk();
      focusRoom(null);
      setShot(hold.shot);
      return;
    }
    dropHold();
    if (dayCamera(now)) return;
    if (moment && now >= moment.until) moment = null;
    if (!moment && moments.length) moment = { ...moments.shift()!, until: now + MOMENT_MS };
    if (moment) return focusRoom(moment);
    const { shot: next, slide, at } = shotAt(now - cycleStart);
    // вторая половина кадра «комнаты» — по очереди к тем, кому нужна помощь РГ
    const turn = careTurn(now - cycleStart);
    const care = turn !== null && states ? careRooms(states) : [];
    if (turn !== null && care.length) return focusRoom(care[turn % care.length]);
    focusRoom(null);
    const walk = next === 'walk' && (walking || (walkFor(at) > 0 && walkers().length >= MIN_WALKERS));
    setShot(next === 'walk' && !walk ? 'rooms' : next);
    if (walk && !walking) {
      walking = true;
      hall.start(walkers(), walkFor(at));
      showBanner('Прогулка · все гуляют в общем зале');
    } else if (!walk) endWalk();
    if (next !== 'group' || !ranking) return;
    const k = slide % SLIDES;
    if (k === GROUPS.length) showSlide('top');
    else {
      ranking.pickGroup(GROUPS[k]);
      showSlide('group');
    }
  }

  const startParty = (gains: ReturnType<typeof paymentGains>) => {
    endWalk();
    dropHold();
    pauseDay();
    const star = pets[GROUPS.indexOf(gains[0].group)];
    partyUntil = Date.now() + PARTY_MS;
    screen.dataset.party = gains[0].group;
    roomBanner = false;
    showBanner(partyBanner(gains));
    setShot('overview');
    if (star.walker) hall.start(walkers(), PARTY_MS, star);
    else hall.cheer(star, PARTY_MS);
  };
  const endParty = () => {
    if (partyUntil === null) return;
    partyUntil = null;
    delete screen.dataset.party;
    hall.stop();
    showBanner(null);
    cycleStart = Date.now();
    camera();
  };

  const tick = () => {
    ticks++;
    if (ticks % TICKER_EVERY === 0) rooms.forEach((r) => r.nextTicker());
    if (partyUntil !== null && Date.now() >= partyUntil) endParty();
    camera();
  };

  const setPower = (mode: PowerMode) => {
    if (mode === power) return;
    const was = power;
    power = mode;
    if (mode === 'idle') {
      idleSince = Date.now();
      pauseDay();
      endWalk();
      endParty();
      clearInterval(loop);
      loop = undefined;
      pets.forEach((p) => p.setRunning(false));
      return;
    }
    loop ??= setInterval(tick, 1000);
    pets.forEach((p) => p.setRunning(true));
    if (idleSince !== null) expireDay(idleSince);
    idleSince = null;
    // ввод (`active`) кадр не меняет, цикл идёт дальше; с начала — только после скрытой вкладки
    if (was === null || was === 'idle') {
      cycleStart = Date.now();
      camera();
    }
  };

  let funnelMemo: { rank: RankData; asOf: DateStr; totals: Record<GroupCode, FunnelTotal> } | null = null;
  const funnelOf = (rank: RankData, asOf: DateStr) => {
    if (funnelMemo?.rank !== rank || funnelMemo.asOf !== asOf) funnelMemo = { rank, asOf, totals: groupFunnel(rank, asOf) };
    return funnelMemo.totals;
  };

  let paid: Record<GroupCode, number> | null = null; // оплаты групп на прошлом обновлении: прирост — праздник
  const update = () => {
    const next = o.states();
    const asOf = o.asOf();
    totals = o.rank ? funnelOf(o.rank(), asOf) : undefined;
    const toys = o.toys?.();
    moments = [...moments, ...growthMoments(states, next)].slice(-MAX_MOMENTS);
    states = next;
    rooms.forEach((r, i) => {
      paint(i);
      r.setToy(toyForRoom(toys?.[r.group] ?? null, next[r.group]), false); // после перезагрузки игрушка уже лежит
    });
    ranking?.update();
    syncDock();
    day.textContent = dayLine(asOf, o.cfg());
    fresh.textContent = o.fresh?.() ?? '';
    const now = Object.fromEntries(GROUPS.map((g) => [g, next[g].totalPayments])) as Record<GroupCode, number>;
    const gains = paymentGains(paid, now);
    paid = now;
    if (gains.length && power !== null && power !== 'idle') startParty(gains);
  };

  const playHand = (group: GroupCode, item: 'medkit' | 'toy') => {
    const i = GROUPS.indexOf(group);
    if (i < 0) return;
    const r = rooms[i].rect;
    rooms[i].playHand(item, Math.max(0, Math.min(r.w - 70, pets[i].x - r.x - 35))); // питомец может быть в зале
    pets[i].emote('joy');
    if (item === 'medkit') setTimeout(() => pets[i].heal(), HAND_MS); // лечит, когда рука донесла аптечку
    // игрушка дня падает в комнату после руки (комната ждёт руку сама), питомец прыгает, когда она коснулась пола.
    // Зовётся до `update` того же снимка: иначе `update` положил бы игрушку сразу, без руки и падения.
    const toy = item === 'toy' && states ? toyForRoom(o.toys?.()[group] ?? null, states[group]) : null;
    if (toy) {
      rooms[i].setToy(toy, true);
      setTimeout(() => pets[i].cheer(), HAND_MS + TOY_LAND_MS);
    }
  };

  /**
   * Итоги дня: комнаты плана — в конец очереди (повтор ждущей группы заменяется, `enqueueDay`), до своей очереди
   * показывают «было». Зовётся до `update` того же снимка (и сразу после `mountTv` при запуске): «стало» не мелькает.
   */
  const playDay = (plan: DayEventPlan) => {
    const at = Date.now();
    for (const r of plan.rooms) {
      if (turn?.room.group !== r.group && !dayQueue.some((q) => q.group === r.group)) held.set(r.group, r.from);
    }
    dayQueue = enqueueDay(dayQueue, plan.rooms.map((r) => ({ ...r, at })));
    dayMs = dayRoomMs(dayQueue.length + (turn ? 1 : 0));
    screen.dataset.day = '';
    GROUPS.forEach((_, i) => paint(i));
    camera();
  };

  update();
  setPower('active');
  return { update, playHand, playDay, setPower };
}
