# ТВ: живые комнаты — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Экран ТВ всё время живой: мяч не застревает, питомцы кусаются на прогулке, загрузка воронки проигрывается событием «итоги дня», подарки РГ видны в комнате.

**Architecture:** Правила — чистые модули рядом с экраном (`src/game/tv/ball.ts`, `bite.ts`, `toys.ts`, `dayEvent.ts`) с тестами Vitest. Анимации — в `PetActor`, `RoomView`, `Hall` и `tv.css` (Web Animations и CSS, как конфетти и рука). `TvScreen` ставит события в очередь камеры рядом с нынешними крупными планами; `src/main.ts` решает, когда событие итогов началось, и помнит показ в `localStorage`.

**Tech Stack:** Vite + TypeScript, DOM/CSS, Vitest, Playwright (`npm run check:render`), мок-бэкенд `tools/mock-backend.mjs` (воронка по 11.11, проверка на `asOf=2026-11-12`).

**Spec:** `docs/superpowers/specs/2026-11-05-tv-pet-life-design.md`

## Global Constraints

- Только фронтенд: `apps-script/` не меняется, данные снимка те же. Правила игры не меняются: награды и «за что» — из движка (`evaluateDay`, `dayResults`), своих копий правил на ТВ нет.
- Тексты дословно: облачко лидера «кусь», отстающего «догоню!»; плашка итогов: «СР3 · итоги 04.11: длинные 2 из 4 — кучка; качественные 7 из 6 — игрушка».
- `prefers-reduced-motion: reduce` — без движения, сразу конечное состояние; плашки остаются.
- Режим `idle` (`PowerSaver`) — ничего не движется; событие итогов, прождавшее в `idle` дольше 15 минут, не показывается, числа сразу текущие.
- Всё событие итогов — не дольше ~45 с; время на комнату `min(7000, 45000 / n)` мс.
- `localStorage`: только ключ `tv-day-shown` (дата `funnelThrough`), чтение и запись в `try/catch`. `sessionStorage` — только номер сборки. PIN нигде.
- Картинки игрушек: PNG ≤ 256 px по большей стороне в `public/assets/toys/`, пути в `ART`, строки в `CREDITS.md` («сгенерировано Codex image_gen, лицензий третьих лиц нет»). Исходники — `work/agent-exchange/jobs/toy-*/workspace/assets/`.
- Атрибуты `data-*` комнаты (`data-piles`, `data-mood`…) всегда показывают настоящее состояние; придерживать до своей очереди можно только видимое (кучки, счётчики, вид питомца).
- В git — только явными путями; не коммитить `.claude/settings.json`, `rooms-and-walk.html`, `work/`, `assets/_raw/`.

## Review Focus

1. Праздник новой оплаты приходит посреди события итогов: событие продолжается после праздника, придержанные комнаты не остаются со старыми числами навсегда. Тест: задача 5 (`dayEvent` очередь / сценарий `check:render`).
2. ТВ открыт в выходной, до первой загрузки (`funnelThrough = null`) или повторно в тот же день: события нет, ничего не падает. Тест: задача 5 (`dayEventPlan`).
3. В том же обновлении питомец вылупился, погиб или это яйцо: текст плашки верный, в конце видимое = настоящее. Тест: задача 5.
4. РГ дал игрушку яйцу или мёртвому питомцу: игрушки в комнате нет, мяч остаётся. Тест: задача 4 (`toyForRoom`).
5. `prefers-reduced-motion`: событие итогов заканчивается верными числами без анимаций. Тест: задача 5 (`check:render` с `reducedMotion: 'reduce'`).

---

### Task 1: Мяч не застревает

**Files:**
- Create: `src/game/tv/ball.ts`, `src/game/tv/ball.test.ts`
- Modify: `src/game/tv/PetActor.ts` (`wander`), `src/game/tv/RoomView.ts` (`placeBall`), `src/game/tv/tv.css`

**Interfaces:**
- Produces: `export const BALL_EDGE = 50;` `export interface Kick { x: number; rot: number; toss: boolean }` `export function kickBall(ballX: number, petX: number, roomW: number, rnd: () => number): Kick` — координаты комнаты; `RoomView.placeBall(toss = false)`.

- [ ] **Step 1: Тесты** в `ball.test.ts` (rnd — фиксированные числа):
  - `kickBall(300, 200, 529, () => 0.5)` → `x` между 300 и 529 − 50, `toss: false` (обычный пинок от питомца);
  - отскок: `kickBall(400, 350, 529, () => 1)` (мяч в 79 px от стены, пинок на 180 упирается в стену 479) → `x = 479 − (400 + 180 − 479) = 378`, `toss: false`;
  - угол: `kickBall(55, 113, 529, () => 0.5)` (мяч у левой стены, питомец справа) → `toss: true`, `x > 113 + 100`; зеркально у правой стены;
  - инвариант: 500 случайных пинков (`Math.random` с seed-обёрткой или LCG в тесте), питомец всегда подходит со своей стороны → `x` всегда в `[50, 479]`, и мяч ни разу не остаётся ближе 60 px к стене два пинка подряд.
- [ ] **Step 2:** `npx vitest run src/game/tv/ball.test.ts` → FAIL (нет модуля).
- [ ] **Step 3: `kickBall`.** Направление — от питомца к мячу; дальность `90 + rnd() * 90`; выход за `[BALL_EDGE, roomW − BALL_EDGE]` отражается от стены; если мяч ближе 60 px к стене и пинок направлен в неё — `toss`: мяч летит через питомца на `120 + rnd() * 80` в другую сторону. `rot` растёт на `(новый x − старый x) * 2.2`, как сейчас.
- [ ] **Step 4:** `PetActor.wander` берёт `kickBall(ball.x, this.x − r.x, r.w, Math.random)`; при `toss` питомец подпрыгивает (`moveTo({}, 420, my, arc 40)`), `emote('joy')`; `RoomView.placeBall(true)` — дуга мяча (`ballEl.animate`, подъём ~140 px, ~700 мс; при reduced motion без дуги).
- [ ] **Step 5:** `npx vitest run src/game/tv/ball.test.ts` → PASS; `npm test` → PASS.
- [ ] **Step 6:** Коммит `fix: ТВ — мяч отскакивает от стены, из угла питомец перекидывает его через себя`.

### Task 2: Аптечка от РГ лечит красным плюсом

**Files:**
- Modify: `src/game/tv/PetActor.ts`, `src/game/tv/TvScreen.ts` (`playHand`), `src/game/tv/tv.css`, `tools/check-render.mjs`

**Interfaces:**
- Produces: `PetActor.heal(): void` — элемент `.heal` (SVG красного плюса) над питомцем, ~2 с: растёт, пульсирует, рассыпается 6 маленькими плюсами; питомец `data-healing` (свечение) на это время; убирается сам (таймер-страховка, как у руки). При reduced motion — плюс 1 с без движения.

- [ ] **Step 1: Сценарий `check:render` (падает):** как нынешний расход игрушки (выдать `setOverride kind: 'medkits' delta: 1` группе СР1 на 12.11, потом `useItem item: 'medkit'`), после опроса — в мире есть `.heal` у питомца СР1 в течение 4 с, через 5 с его нет.
- [ ] **Step 2:** `npm run check:render` → FAIL на новом сценарии.
- [ ] **Step 3:** `heal()` в `PetActor`; `TvScreen.playHand` для `medkit` зовёт `pets[i].heal()` после руки (задержка `HAND_MS` = 1800 мс, с учётом очереди рук не нужна).
- [ ] **Step 4:** `npm run check:render` → OK; `npm test` → PASS.
- [ ] **Step 5:** Коммит `feat: ТВ — аптечка от РГ лечит красным плюсом`.

### Task 3: «Кусь» на прогулке

**Files:**
- Create: `src/game/tv/bite.ts`, `src/game/tv/bite.test.ts`
- Modify: `src/game/tv/PetActor.ts` (поле плана, `say`, крадущийся шаг), `src/game/tv/Hall.ts` (`mingle`), `src/game/tv/art.ts` (эмоция «!», если её нет), `src/game/tv/tv.css`

**Interfaces:**
- Produces: `export interface Biter { id: GroupCode; plan: number | null; sick: boolean }` `export interface Bite { biter: GroupCode; victim: GroupCode; line: 'кусь' | 'догоню!' }` `export function pickBite(walkers: Biter[], rnd: () => number): Bite | null`; `PetActor.plan: number | null` (из `PetState.planPercent` в `update`); `PetActor.say(text: string, ms?: number): void` — облачко с текстом.

- [ ] **Step 1: Тесты** `bite.test.ts`:
  - СР1 80 %, СР2 20 %, СР3 50 %; `rnd = () => 0.2` → `{biter: 'СР1', victim: 'СР2', line: 'кусь'}`; `rnd = () => 0.7` → `{biter: 'СР2', victim: 'СР1', line: 'догоню!'}`;
  - больной не участвует (даже если он отстающий): пара из здоровых;
  - меньше двух здоровых → `null`;
  - все `plan: null` или все равны → случайная пара, `line: 'кусь'`;
  - при равенстве лидеров берётся случайный из равных (детерминированно от `rnd`).
- [ ] **Step 2:** `npx vitest run src/game/tv/bite.test.ts` → FAIL.
- [ ] **Step 3:** `pickBite`: 50/50 по первому `rnd()` между «лидер → отстающий» и «отстающий → лидер».
- [ ] **Step 4: Сцена в `Hall.mingle`** после встреч пар и до визита к больному, только без `star` (праздник): жертва отворачивается от кусающего; кусающий крадётся (класс `sneak`: пригнут, медленно, `SPEED.hall / 3`) на 140 px за спину, рывок на 60 px за 250 мс, `say(line, 1400)` над кусающим; жертва подпрыгивает (`moveTo({}, 450, t, arc 80)`), эмоция «!», отбегает на 150 px. ~4–5 с, по жетонам `tokens` (перехваченный выпадает, как во встречах). Reduced motion: без прыжков, облачко и эмоция остаются.
- [ ] **Step 5:** `npm test` → PASS; `npx tsc --noEmit` → OK. Ручная проверка: скрипт в scratchpad открывает `/?demo=1` и ждёт прогулку, один скриншот сцены укуса.
- [ ] **Step 6:** Коммит `feat: ТВ — на прогулке лидер кусает отстающего («кусь»), отстающий лидера («догоню!»)`.

### Task 4: Игрушка от РГ в комнате до конца дня

**Files:**
- Create: `src/game/tv/toys.ts`, `src/game/tv/toys.test.ts`, `public/assets/toys/{bear,duck,top,cube,hedgehog}.png`
- Modify: `src/art/manifest.ts` (`ART.toys`), `src/game/tv/RoomView.ts`, `src/game/tv/PetActor.ts` (`wander`), `src/game/tv/TvScreen.ts` (опция и `playHand`), `src/main.ts`, `src/game/tv/tv.css`, `CREDITS.md`, `tools/check-render.mjs`

**Interfaces:**
- Consumes: `kickBall` (задача 1); `SnapshotOverride` (`src/data/api.ts`: `id, date, group, kind`).
- Produces: `export type ToyKind = 'bear' | 'duck' | 'top' | 'cube' | 'hedgehog'` `export type ToyPlay = 'hug' | 'bounce' | 'spin' | 'roll'` `export const TOYS: readonly { kind: ToyKind; play: ToyPlay }[]` (порядок: bear/hug, duck/bounce, top/spin, cube/roll, hedgehog/roll) `export function toyKindFor(useId: number): ToyKind` (`TOYS[useId % 5]`) `export function toyOfDay(overrides: SnapshotOverride[], group: GroupCode, today: DateStr): { id: number; kind: ToyKind } | null` `export function toyForRoom(toy: ReturnType<typeof toyOfDay>, s: PetState): ToyKind | null`; `TvOptions.toys?: () => Record<GroupCode, { id: number; kind: ToyKind } | null>`; `RoomView.setToy(kind: ToyKind | null, drop: boolean): void`.

- [ ] **Step 1: Картинки.** Взять PNG из `work/agent-exchange/jobs/toy-{bear,duck,top,cube,hedgehog}/workspace/assets/` (статус задания `ready`), уменьшить до 256 px по большей стороне с прозрачностью (Python + Pillow, если есть; иначе `ffmpeg` из `imageio-ffmpeg`), положить в `public/assets/toys/`. Не готово — временно `ART.toy` для всех видов (решение спеки) и пометка в отчёте.
- [ ] **Step 2: Тесты** `toys.test.ts`: `toyKindFor(7) === 'top'`; `toyOfDay` берёт последнюю по `id` строку `useToy` группы с `date === today`, игнорирует другие группы, другие даты и `useMedkit`, без строк — `null`; `toyForRoom` даёт `null` для яйца и мёртвого, вид — для живого вылупившегося.
- [ ] **Step 3:** `npx vitest run src/game/tv/toys.test.ts` → FAIL; реализация; → PASS.
- [ ] **Step 4: Комната.** `RoomView.setToy`: игрушка встаёт вместо мяча (тот же `ball.x`, мяч скрыт, `data-toy=<kind>` на `[data-group]`); `drop: true` — падает сверху с отскоком. `PetActor.wander` играет по `play`: `roll` — как мяч (`kickBall`); `bounce` — пинок с прыжком игрушки; `spin` — подходит, игрушка крутится на месте (класс `spin`, ~1,5 с); `hug` — подходит, обнимает (сердечки, эмоция `love` или `joy`). `null` — снова мяч.
- [ ] **Step 5: Подключение.** `main.ts` передаёт `toys: () => GROUPS → toyOfDay(snapshot.overrides, g, asOf())`; `TvScreen.update` зовёт `rooms[i].setToy(toyForRoom(toy, state), false)` (без падения — после перезагрузки игрушка уже лежит); в `playHand('toy')` после руки — `setToy(kind, true)`, питомец прыгает и радуется.
- [ ] **Step 6: Сценарий `check:render`** (после нынешнего расхода игрушки СР1): у `[data-group="СР1"]` появился `data-toy`, видна картинка из `assets/toys/`, `.ball` скрыт; у других групп мяч на месте.
- [ ] **Step 7:** `npm test`, `npm run check:render` → OK; `CREDITS.md` — 5 строк.
- [ ] **Step 8:** Коммит `feat: ТВ — игрушка от РГ падает в комнату, питомец играет с ней до конца дня`.

### Task 5: Событие «итоги дня»

**Files:**
- Create: `src/game/tv/dayEvent.ts`, `src/game/tv/dayEvent.test.ts`
- Modify: `src/game/tv/TvScreen.ts`, `src/game/tv/RoomView.ts`, `src/game/tv/PetActor.ts`, `src/game/tv/tv.css`, `src/main.ts`, `tools/check-render.mjs`

**Interfaces:**
- Consumes: `dayResults(s, date)` из `src/admin/results.ts` (`GroupLine.day` — ячейки `quality`/`long` с `fact`/`plan`; `outcome` — `pile`, `pileRemoved`, `medkit`, `toy`, `evaluated`); `buildFacts`; `workingDaysBetween`, `nextWorkingDay`, `prevWorkingDay` (`src/engine/calendar.ts`); `configOf`/`timelineOf` для календаря снимка.
- Produces:
  ```ts
  export interface RoomEvent { group: GroupCode; text: string; from: PetState; to: PetState }
  export interface DayEventPlan { through: DateStr; days: DateStr[]; rooms: RoomEvent[] }
  /** prev — прошлый снимок (null при запуске); shown — `tv-day-shown` из localStorage */
  export function dayEventPlan(prev: Snapshot | null, s: Snapshot, asOf: DateStr, shown: string | null): DayEventPlan | null;
  export function roomText(line: GroupLine, days: DateStr[]): string;
  // TvScreen
  playDay(plan: DayEventPlan): void;
  // PetActor / RoomView
  PetActor.strain(): Promise<void>;          // сплющился, дрожит ~1,2 с
  RoomView.update(s: PetState, funnel?: FunnelTotal, shown?: PetState): void; // data-* по s, видимое по shown
  RoomView.dropCrate(kind: 'medkits' | 'toys'): void; RoomView.poofPile(): void;
  ```

- [ ] **Step 1: Тесты** `dayEvent.test.ts` на вымышленном снимке (как в `src/admin/results.test.ts`):
  - живое событие: `prev.funnelThrough = '2026-11-03'`, `s.funnelThrough = '2026-11-05'` (04.11 выходной) → `days = ['2026-11-05']`; `from` — состояния при `funnelThrough` 03.11, `to` — нынешние;
  - запуск: `prev = null`, сегодня 06.11 = следующий рабочий после `funnelThrough` 05.11, `shown = null` → план; `shown = '2026-11-05'` → `null`; сегодня 09.11 (не следующий рабочий) → `null`; `funnelThrough = null` → `null`;
  - `funnelThrough` не сдвинулся (правка или оплата) → `null`;
  - `roomText`: недобор длинных → «СР3 · итоги 05.11: длинные 2 из 4 — кучка; качественные 7 из 6 — игрушка»; норма длинных выполнена → «… — аптечка», если кучка убрана — «аптечка, −1 кучка»; качественные не выполнены → «— без игрушки»; длинные не обязательны — без части про длинные; кучек уже максимум → «кучка (уже 5)»; два дня → в конце «· ещё 1 дн.»; дробные нормы с запятой («1,5»);
  - комнаты: только с вердиктом или разницей; порядок групп как `GROUPS`; яйцо с кучкой — в списке; мёртвый — нет.
- [ ] **Step 2:** `npx vitest run src/game/tv/dayEvent.test.ts` → FAIL; реализация; → PASS.
- [ ] **Step 3: Очередь камеры в `TvScreen`.** `playDay`: комнаты события идут раньше нынешних `moments` (рост — после), отдельной очередью, без предела `MAX_MOMENTS`; время на комнату `min(7000, 45000 / n)`. До своей очереди комната и питомец показывают `from` (видимое), `data-*` — настоящее. В свою очередь: крупный план с плашкой `text`; по разнице `from → to`: кучка — `pets[i].strain()`, потом кучка «пум» (видимое → `to`); убранная кучка — `poofPile()`; аптечка, игрушка — `dropCrate`, счётчик +1 с подпрыгиванием. Праздник оплаты ставит событие на паузу, после него событие продолжается. В `idle` дольше 15 мин — событие снимается, видимое = настоящее. Вторая загрузка во время события — её комнаты в конец, повторы групп заменяются.
- [ ] **Step 4: `main.ts`.** На каждом снимке — `dayEventPlan(prevSnapshot, snapshot, asOf(), shown)`; при плане — записать `tv-day-shown = plan.through` (в `try/catch`) и `tv.playDay(plan)`. Недоступное хранилище: при запуске события нет (`shown` считается равным `funnelThrough`), живое событие остаётся.
- [ ] **Step 5: Сценарии `check:render`.**
  - Загрузка `?asOf=2026-11-12` (воронка по 11.11) в чистом контексте → в первые 8 с плашка содержит «итоги 11.11»; к концу события (≤ 50 с от загрузки) у каждой комнаты число картинок `.pile` равно `data-piles`, счётчики аптечек и игрушек равны состоянию.
  - Перезагрузка в том же контексте → плашки «итоги» нет 10 с.
  - Отдельный контекст `reducedMotion: 'reduce'` → в конце числа верные.
  - Нынешние проверки экрана, которые читают `data-*` сразу после загрузки, остаются зелёными (видимое придерживается, `data-*` — нет); если какая-то проверка читает видимые числа в первые секунды — ждать конца события или открыть её в контексте с `tv-day-shown = '2026-11-11'`, записанным до загрузки.
- [ ] **Step 6:** `npm test`, `npx tsc --noEmit`, `npm run check:render` → OK.
- [ ] **Step 7:** Коммит `feat: ТВ — событие «итоги дня» при загрузке воронки: кто что получил и за что`.

### Финал (контроллер)

- `~/.local/bin/graphify.exe update .`; `.claude/skills/game-architecture/SKILL.md` — строка про `ball.ts`, `bite.ts`, `toys.ts`, `dayEvent.ts`; `PLAN.md`.
- Финальное ревью ветки субагентом `reviewer` с Review Focus; исправления Critical/Important с тестом RED→GREEN.
- `npm test`, `npm run build`, `check:render`, `check:admin`, `check:dist`, `audit:publish` (только прежний FAIL истории); выпуск: push `tv-screen:master`, Pages, `check-live --backend`, `version.json`. Скриншоты ключевых кадров владельцу.
