import '@fontsource-variable/nunito'; // свой файл шрифта: на ТВ может не быть доступа к Google Fonts
import './game/room.css';
import { api, backendUrl, resolvePollMs, serverToday } from '@/data/api';
import { reloadForBuild, watchBuild } from '@/data/build';
import { buildFacts } from '@/data/facts';
import { createStore } from '@/data/store';
import { buildDemo, groupFacts } from '@/demo/demoFacts';
import { moscowToday, parseDate } from '@/engine/calendar';
import { defaultConfig } from '@/engine/config';
import { simulate, type PetState } from '@/engine/pet';
import { itemByCode, type ShopState } from '@/engine/shop';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import { PowerSaver } from '@/game/PowerSaver';
import { dayPlanner, type DayEventPlan } from '@/game/tv/dayEvent';
import { freshLine } from '@/game/tv/metrics';
import { mountTv, type Tv } from '@/game/tv/TvScreen';
import { TOYS, toyOfDay, type ToyKind } from '@/game/tv/toys';
import { newUses } from '@/game/uses';

/** Дата витрины по умолчанию: середина игры, видны все состояния. */
const DEMO_AS_OF: DateStr = '2026-11-12';
/** `funnelThrough`, итоги которого этот ТВ уже начал показывать: перезагрузка их не повторяет (не PIN). */
const DAY_SHOWN_KEY = 'tv-day-shown';

const params = new URLSearchParams(location.search);
const root = document.getElementById('app')!;

function demoStates(asOf: DateStr): Record<GroupCode, PetState> {
  const demo = buildDemo(asOf);
  return Object.fromEntries(
    GROUPS.map((g) => [g, simulate(groupFacts(demo, g, asOf), asOf, defaultConfig)]),
  ) as Record<GroupCode, PetState>;
}

/** Демо `?toy=balloon,yoyo,…`: игрушки дня вылупившимся по порядку групп (неизвестные виды пропускаются). */
function demoToys(states: Record<GroupCode, PetState>): Record<GroupCode, ReturnType<typeof toyOfDay>> {
  const kinds = (params.get('toy') ?? '').split(',').filter((k): k is ToyKind => TOYS.some((t) => t.kind === k));
  const hatched = GROUPS.filter((g) => states[g].alive && states[g].phase === 'pet');
  return Object.fromEntries(GROUPS.map((g) => {
    const kind = kinds[hatched.indexOf(g)];
    return [g, hatched.includes(g) && kind ? { id: 0, kind } : null];
  })) as Record<GroupCode, ReturnType<typeof toyOfDay>>;
}

/** Демо `?shop=СР3:1,4,7;СР6:2,5`: мебель групп по кодам каталога (неизвестное пропускается), монет нет; `?beach=СР3,СР6` — группы в отпуске. */
function demoShop(): Record<GroupCode, ShopState> {
  const owned = Object.fromEntries(GROUPS.map((g) => [g, {}])) as Record<GroupCode, ShopState['owned']>;
  for (const part of (params.get('shop') ?? '').split(';')) {
    const [group, codes = ''] = part.split(':');
    if (!GROUPS.includes(group as GroupCode)) continue;
    for (const code of codes.split(',')) {
      const item = itemByCode(Number(code));
      if (item) owned[group as GroupCode][item.place] = item.id;
    }
  }
  const beach = (params.get('beach') ?? '').split(',');
  return Object.fromEntries(GROUPS.map((g) => [g, { coins: 0, granted: 0, spent: 0, balance: 0, owned: owned[g], vacation: beach.includes(g), today: 0 }])) as Record<GroupCode, ShopState>;
}

/**
 * Живой экран: снимок с бэкенда раз в 15 с, питомцы и рейтинги считаются из него на дату `asOf`.
 * «Сегодня» — по часам сервера (R23), а не телевизора: часы на мониторе могут врать.
 */
function startLive(): void {
  const status = document.createElement('div');
  status.className = 'status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  status.textContent = 'Нет связи с сервером';
  const tvRoot = document.createElement('div');
  tvRoot.textContent = 'Загрузка…';
  root.replaceChildren(status, tvRoot);

  let answeredAt = new Date(); // последний ответ сервера — для строки «обновлено»
  const store = createStore({
    fetchSnapshot: async (since) => {
      try {
        const next = await api.get(since);
        answeredAt = new Date();
        status.hidden = true;
        return next;
      } catch (e) {
        status.hidden = false;
        throw e;
      }
    },
    pollMs: resolvePollMs(location.search, { dev: import.meta.env.DEV, hostname: location.hostname }),
  });
  // экран создаётся по первому снимку; store.current() после этого уже не пуст
  const asOf = () => {
    const s = store.current();
    return parseDate(params.get('asOf'), s ? serverToday(s) : moscowToday());
  };
  const facts = () => buildFacts(store.current()!, asOf());
  let tv: Tv | undefined;
  let maxSeen: number | null = null; // наибольший id расхода РГ, уже показанный рукой (R20)
  const planDay = dayPlanner(); // по прошлому снимку: сдвиг funnelThrough — загружена воронка, событие «итоги дня»
  /** Показ итогов не роняет обновление экрана: ошибка — в консоль без данных, ТВ обновляется как обычно. */
  const playDay = (day: DayEventPlan) => {
    try {
      tv!.playDay(day);
    } catch (e) {
      console.error('Итоги дня не показаны:', e instanceof Error ? e.message : e);
    }
  };
  store.subscribe((snapshot) => {
    const { unmatchedAuthors } = buildFacts(snapshot, asOf());
    if (unmatchedAuthors.length) console.warn(`Авторы оплат не найдены в штате (${unmatchedAuthors.length}):`, unmatchedAuthors);
    const { uses, max } = newUses(maxSeen, snapshot.overrides);
    maxSeen = max;
    // без хранилища показ при запуске пропускается (итоги считаются показанными), живое событие остаётся
    let shown: string | null;
    try {
      shown = localStorage.getItem(DAY_SHOWN_KEY);
    } catch {
      shown = snapshot.funnelThrough;
    }
    const day = planDay(snapshot, asOf(), shown);
    if (day) {
      try {
        localStorage.setItem(DAY_SHOWN_KEY, day.through);
      } catch { /* не запомнили: при перезапуске итоги покажутся ещё раз */ }
    }
    if (tv) {
      // рука раньше обновления: игрушку дня, которую несёт рука, комната показывает падением после руки, а не сразу;
      // итоги тоже раньше: комнаты события не мелькают новыми числами до своей очереди
      for (const u of uses) tv.playHand(u.group, u.kind === 'useMedkit' ? 'medkit' : 'toy');
      if (day) playDay(day);
      tv.update();
    } else {
      tv = mountTv(tvRoot, {
        states: () => facts().states,
        rank: () => facts().rank,
        asOf,
        cfg: () => facts().rank.cfg,
        shop: () => facts().shop,
        toys: () => {
          const { overrides } = store.current()!;
          const today = asOf();
          return Object.fromEntries(GROUPS.map((g) => [g, toyOfDay(overrides, g, today)])) as Record<GroupCode, ReturnType<typeof toyOfDay>>;
        },
        fresh: () => {
          const s = store.current()!;
          return freshLine({ at: answeredAt, funnelThrough: s.funnelThrough, paymentsThrough: s.paymentsImportedThrough });
        },
      });
      if (day) playDay(day); // в той же задаче, что и первый показ: «стало» не успевает нарисоваться
    }
  });

  const power = new PowerSaver(document.documentElement);
  power.onTick((mode) => {
    tv?.setPower(mode);
    tv?.update();
  });
  power.start();
  store.start();
  watchBuild(reloadForBuild); // ТВ никто не обновит руками: на новую версию страница переходит сама
}

if (params.has('demo')) {
  const asOf = parseDate(params.get('asOf'), DEMO_AS_OF);
  const states = demoStates(asOf);
  const toys = demoToys(states);
  const shop = demoShop();
  const tv = mountTv(root, { states: () => states, asOf: () => asOf, cfg: () => defaultConfig, toys: () => toys, shop: () => shop });
  const power = new PowerSaver(document.documentElement);
  power.onTick(tv.setPower);
  power.start();
} else if (backendUrl()) {
  startLive();
} else {
  root.textContent = 'Игра ещё не запущена. Откройте страницу с параметром ?demo=1';
}
