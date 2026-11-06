import '@fontsource-variable/nunito'; // свой файл шрифта: на ТВ может не быть доступа к Google Fonts
import './game/room.css';
import { api, backendUrl, resolvePollMs, serverToday, type Snapshot } from '@/data/api';
import { reloadForBuild, watchBuild } from '@/data/build';
import { buildFacts } from '@/data/facts';
import { createStore } from '@/data/store';
import { buildDemo, groupFacts } from '@/demo/demoFacts';
import { moscowToday, parseDate } from '@/engine/calendar';
import { defaultConfig } from '@/engine/config';
import { simulate, type PetState } from '@/engine/pet';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import { PowerSaver } from '@/game/PowerSaver';
import { dayEventPlan } from '@/game/tv/dayEvent';
import { freshLine } from '@/game/tv/metrics';
import { mountTv, type Tv } from '@/game/tv/TvScreen';
import { toyOfDay } from '@/game/tv/toys';
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
  let prev: Snapshot | null = null; // прошлый снимок: сдвиг funnelThrough — загружена воронка, событие «итоги дня»
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
    const day = dayEventPlan(prev, snapshot, asOf(), shown);
    prev = snapshot;
    if (day) {
      try {
        localStorage.setItem(DAY_SHOWN_KEY, day.through);
      } catch { /* не запомнили: при перезапуске итоги покажутся ещё раз */ }
    }
    if (tv) {
      // рука раньше обновления: игрушку дня, которую несёт рука, комната показывает падением после руки, а не сразу;
      // итоги тоже раньше: комнаты события не мелькают новыми числами до своей очереди
      for (const u of uses) tv.playHand(u.group, u.kind === 'useMedkit' ? 'medkit' : 'toy');
      if (day) tv.playDay(day);
      tv.update();
    } else {
      tv = mountTv(tvRoot, {
        states: () => facts().states,
        rank: () => facts().rank,
        asOf,
        cfg: () => facts().rank.cfg,
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
      if (day) tv.playDay(day); // в той же задаче, что и первый показ: «стало» не успевает нарисоваться
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
  const tv = mountTv(root, { states: () => states, asOf: () => asOf, cfg: () => defaultConfig });
  const power = new PowerSaver(document.documentElement);
  power.onTick(tv.setPower);
  power.start();
} else if (backendUrl()) {
  startLive();
} else {
  root.textContent = 'Игра ещё не запущена. Откройте страницу с параметром ?demo=1';
}
