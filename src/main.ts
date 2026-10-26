import './game/room.css';
import { api, backendUrl, resolvePollMs } from '@/data/api';
import { buildFacts } from '@/data/facts';
import { createStore } from '@/data/store';
import { buildDemo, groupFacts } from '@/demo/demoFacts';
import { moscowToday, parseDate } from '@/engine/calendar';
import { defaultConfig } from '@/engine/config';
import { simulate, type PetState } from '@/engine/pet';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import { PowerSaver } from '@/game/PowerSaver';
import { mountRanking } from '@/game/RankingPanel';
import { mount } from '@/game/render';
import { newUses } from '@/game/uses';

/** Дата витрины по умолчанию: середина игры, видны все состояния. */
const DEMO_AS_OF: DateStr = '2026-11-12';
/** Дневная норма оплат группы для сытости; в бою придёт из среднего прошлого месяца. */
const DEMO_DAILY_NORM = 4;

const params = new URLSearchParams(location.search);
const root = document.getElementById('app')!;

function demoStates(): Record<GroupCode, PetState> {
  const asOf = parseDate(params.get('asOf'), DEMO_AS_OF);
  const demo = buildDemo(asOf);
  return Object.fromEntries(
    GROUPS.map((g) => [g, simulate({ ...groupFacts(demo, g, asOf), dailyNorm: DEMO_DAILY_NORM }, asOf, defaultConfig)]),
  ) as Record<GroupCode, PetState>;
}

/** Живой экран: снимок с бэкенда раз в 15 с, питомцы и рейтинги считаются из него на дату `asOf`. */
function startLive(): void {
  const asOf = () => parseDate(params.get('asOf'), moscowToday());
  const status = document.createElement('div');
  status.className = 'status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  status.textContent = 'Нет связи с сервером';
  const roomRoot = document.createElement('div');
  roomRoot.textContent = 'Загрузка…';
  const rankingRoot = document.createElement('div');
  root.replaceChildren(status, roomRoot, rankingRoot);

  const store = createStore({
    fetchSnapshot: async (since) => {
      try {
        const next = await api.get(since);
        status.hidden = true;
        return next;
      } catch (e) {
        status.hidden = false;
        throw e;
      }
    },
    pollMs: resolvePollMs(location.search, { dev: import.meta.env.DEV, hostname: location.hostname }),
  });
  // панели создаются по первому снимку; store.current() после этого уже не пуст
  const facts = () => buildFacts(store.current()!, asOf());
  let view: ReturnType<typeof mount> | undefined;
  let ranking: { update(): void } | undefined;
  let maxSeen: number | null = null; // наибольший id расхода РГ, уже показанный рукой (R20)
  store.subscribe((snapshot) => {
    const { unmatchedAuthors } = buildFacts(snapshot, asOf());
    if (unmatchedAuthors.length) console.warn(`Авторы оплат не найдены в штате (${unmatchedAuthors.length}):`, unmatchedAuthors);
    const { uses, max } = newUses(maxSeen, snapshot.overrides);
    maxSeen = max;
    if (view && ranking) {
      view.update();
      ranking.update();
      for (const u of uses) view.playHand(u.group, u.kind === 'useMedkit' ? 'medkit' : 'toy');
    } else {
      view = mount(roomRoot, () => facts().states);
      ranking = mountRanking(rankingRoot, () => facts().rank, { asOf });
    }
  });

  const power = new PowerSaver(document.documentElement);
  power.onTick(() => {
    view?.update();
    ranking?.update();
  });
  power.start();
  store.start();
}

if (params.has('demo')) {
  const view = mount(root, demoStates);
  const power = new PowerSaver(document.documentElement);
  power.onTick(view.update);
  power.start();
} else if (backendUrl()) {
  startLive();
} else {
  root.textContent = 'Игра ещё не запущена. Откройте страницу с параметром ?demo=1';
}
