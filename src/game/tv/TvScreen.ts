import './tv.css';
import type { Config } from '@/engine/config';
import type { PetState } from '@/engine/pet';
import type { RankData } from '@/engine/ranking';
import { THEME } from '@/art/manifest';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import type { PowerMode } from '@/game/PowerSaver';
import { mountRanking, short } from '@/game/RankingPanel';
import { PLANTS } from './art';
import { Hall } from './Hall';
import { BOARDS, CAMERA, roomCamera, roomRect, STAGE } from './layout';
import { dayLine, groupFunnel, partyBanner, paymentGains, type FunnelTotal } from './metrics';
import { careRooms, growthMoments, MAX_MOMENTS, type RoomMoment } from './moments';
import { PetActor } from './PetActor';
import { RoomView } from './RoomView';
import { shotAt, walkFor, type Shot } from './schedule';

export interface TvOptions {
  states: () => Record<GroupCode, PetState>;
  asOf: () => DateStr;
  /** настройки на `asOf`: календарь для строки «день N из 14» */
  cfg: () => Config;
  /** данные рейтингов; без них (демо) доски пустые */
  rank?: () => RankData;
  /** строка свежести данных справа вверху */
  fresh?: () => string;
}

export interface Tv {
  update(): void;
  playHand(group: GroupCode, item: 'medkit' | 'toy'): void;
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
/** Кадр «комнаты»: столько общий план, дальше визиты к тем, кому нужна помощь, по `CARE_MS`. */
const CARE_FROM = 12_000;
const CARE_MS = 6_500;

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

  const showBanner = (text: string | null) => {
    if (text !== null) banner.textContent = text;
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
  let roomBanner = false;
  /** Крупный план комнаты с плашкой; `null` — убрать плашку крупного плана. Из зала питомец сразу дома. */
  const focusRoom = (m: RoomMoment | null) => {
    if (!m) {
      if (roomBanner) showBanner(null);
      roomBanner = false;
      return;
    }
    endWalk();
    const i = GROUPS.indexOf(m.group);
    if (setShot('room', true, i)) pets[i].release();
    roomBanner = true;
    showBanner(m.text);
  };
  function camera(): void {
    if (power === null || power === 'idle' || partyUntil !== null) return;
    const now = Date.now();
    if (hold && now < hold.until) {
      endWalk();
      focusRoom(null);
      setShot(hold.shot);
      return;
    }
    if (hold) {
      // выбор зрителя живёт, пока длится удержание: дальше у героев снова день по умолчанию
      hold = null;
      ranking?.resetDay();
      syncDock();
    }
    if (moment && now >= moment.until) moment = null;
    if (!moment && moments.length) moment = { ...moments.shift()!, until: now + MOMENT_MS };
    if (moment) return focusRoom(moment);
    const { shot: next, slide, at } = shotAt(now - cycleStart);
    // вторая половина кадра «комнаты» — по очереди к тем, кому нужна помощь РГ
    const care = next === 'rooms' && at >= CARE_FROM && states ? careRooms(states) : [];
    if (care.length) return focusRoom(care[(Math.floor((at - CARE_FROM) / CARE_MS) + slide) % care.length]);
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
    hold = null;
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
      endWalk();
      endParty();
      clearInterval(loop);
      loop = undefined;
      pets.forEach((p) => p.setRunning(false));
      return;
    }
    loop ??= setInterval(tick, 1000);
    pets.forEach((p) => p.setRunning(true));
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
    const totals = o.rank ? funnelOf(o.rank(), asOf) : undefined;
    rooms.forEach((r, i) => {
      r.update(next[r.group], totals?.[r.group]);
      pets[i].update(next[r.group]);
    });
    moments = [...moments, ...growthMoments(states, next)].slice(-MAX_MOMENTS);
    states = next;
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
  };

  update();
  setPower('active');
  return { update, playHand, setPower };
}
