import './game/room.css';
import { buildDemo, groupFacts } from '@/demo/demoFacts';
import { defaultConfig } from '@/engine/config';
import { simulate, type PetState } from '@/engine/pet';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import { PowerSaver } from '@/game/PowerSaver';
import { mount } from '@/game/render';

/** Дата витрины по умолчанию: середина игры, видны все состояния. */
const DEMO_AS_OF: DateStr = '2026-11-12';
/** Дневная норма оплат группы для сытости; в бою придёт из среднего прошлого месяца. */
const DEMO_DAILY_NORM = 4;

const params = new URLSearchParams(location.search);
const root = document.getElementById('app')!;

function demoStates(): Record<GroupCode, PetState> {
  const asOf = (params.get('asOf') ?? DEMO_AS_OF) as DateStr;
  const demo = buildDemo(asOf);
  return Object.fromEntries(
    GROUPS.map((g) => [g, simulate({ ...groupFacts(demo, g, asOf), dailyNorm: DEMO_DAILY_NORM }, asOf, defaultConfig)]),
  ) as Record<GroupCode, PetState>;
}

if (params.has('demo')) {
  const view = mount(root, demoStates);
  const power = new PowerSaver(document.documentElement);
  power.onTick(view.update);
  power.start();
} else {
  root.textContent = 'Игра ещё не запущена. Откройте страницу с параметром ?demo=1';
}
