import './tv.css';
import type { Config } from '@/engine/config';
import type { PetState } from '@/engine/pet';
import type { RankData } from '@/engine/ranking';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import type { PowerMode } from '@/game/PowerSaver';
import { mountRanking } from '@/game/RankingPanel';
import { PLANTS } from './art';
import { Hall } from './Hall';
import { BOARDS, CAMERA, roomRect, STAGE } from './layout';
import { dayLine, groupFunnel, partyBanner, paymentGains, type FunnelTotal } from './metrics';
import { PetActor } from './PetActor';
import { RoomView } from './RoomView';
import { shotAt, WALK_MS, type Shot } from './schedule';

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

const div = (cls: string, text?: string) => {
  const node = document.createElement('div');
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const plant = (side: 'left' | 'right') => {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg class="fg ${side}" viewBox="0 0 300 360" aria-hidden="true">${PLANTS[side]}</svg>`;
  return wrap.firstElementChild!;
};

/**
 * Экран ТВ: сцена 1920×1080, вписанная в окно; мир — зал с досками рейтингов и домик из шести комнат.
 * Камера: при вводе (`active`) — общий план, на стене (`ambient`) — цикл `shotAt` с прогулкой в зале, вкладка скрыта
 * (`idle`) — всё стоит. Новая оплата группы — праздник на общем плане (`data-party`), потом цикл с начала.
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
  if (ranking) {
    heroesBoard.append(ranking.blocks.heroes);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'board-toggle';
    toggle.addEventListener('click', () => showSlide(groupBoard.dataset.slide === 'top' ? 'group' : 'top'));
    groupBoard.append(ranking.blocks.group, ranking.blocks.top, toggle);
  } else {
    heroesBoard.append(div('board-empty', 'Герои дня появятся с первыми данными'));
    groupBoard.append(div('board-empty', 'Рейтинги появятся с первыми данными'));
  }

  function showSlide(slide: 'group' | 'top'): void {
    groupBoard.dataset.slide = slide;
    const toggle = groupBoard.querySelector('.board-toggle');
    if (toggle) toggle.textContent = slide === 'top' ? 'Рейтинг группы' : 'Топ-10';
  }
  showSlide('group');

  const doFit = () => {
    const s = Math.min(innerWidth / STAGE.w, innerHeight / STAGE.h);
    fit.style.transform = `translate(${(innerWidth - STAGE.w * s) / 2}px, ${(innerHeight - STAGE.h * s) / 2}px) scale(${s})`;
  };
  addEventListener('resize', doFit);
  doFit();

  let shot: Shot | null = null;
  const setShot = (next: Shot, animate = true) => {
    if (next === shot) return;
    shot = next;
    screen.dataset.shot = next;
    if (!animate) world.style.transition = 'none';
    world.style.transform = CAMERA[next];
    if (!animate) {
      void world.offsetWidth;
      world.style.transition = '';
    }
  };
  setShot('overview', false);

  const showBanner = (text: string | null) => {
    if (text !== null) banner.textContent = text;
    banner.classList.toggle('on', text !== null);
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
  const camera = () => {
    if (power !== 'ambient' || partyUntil !== null) return;
    const { shot: next, slide } = shotAt(Date.now() - cycleStart);
    const walk = next === 'walk' && (walking || walkers().length >= MIN_WALKERS);
    setShot(next === 'walk' && !walk ? 'rooms' : next);
    if (walk && !walking) {
      walking = true;
      hall.start(walkers(), WALK_MS - 1000);
      showBanner('Прогулка · все гуляют в общем зале');
    } else if (!walk) endWalk();
    if (next !== 'group' || !ranking) return;
    const k = slide % SLIDES;
    if (k === GROUPS.length) showSlide('top');
    else {
      showSlide('group');
      ranking.pickGroup(GROUPS[k]);
    }
  };

  const startParty = (gains: ReturnType<typeof paymentGains>) => {
    endWalk();
    const star = pets[GROUPS.indexOf(gains[0].group)];
    partyUntil = Date.now() + PARTY_MS;
    screen.dataset.party = gains[0].group;
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
    if (power === 'active') setShot('overview');
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
    if (mode === 'active') {
      endWalk();
      setShot('overview');
    } else if (was !== 'ambient') {
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
    const states = o.states();
    const asOf = o.asOf();
    const totals = o.rank ? funnelOf(o.rank(), asOf) : undefined;
    rooms.forEach((r, i) => {
      r.update(states[r.group], totals?.[r.group]);
      pets[i].update(states[r.group]);
    });
    ranking?.update();
    day.textContent = dayLine(asOf, o.cfg());
    fresh.textContent = o.fresh?.() ?? '';
    const now = Object.fromEntries(GROUPS.map((g) => [g, states[g].totalPayments])) as Record<GroupCode, number>;
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
