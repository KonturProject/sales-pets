# Экран ТВ «Комнаты и зал», фаза А — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** заменить экран карточек на сцену «домик из шести комнат + зал с досками рейтингов» по макету `rooms-and-walk.html`, без прокрутки, со всеми состояниями движка, к старту игры 02.11.

**Architecture:** новый вид `src/game/tv/`: чистые функции (геометрия, расписание камеры, цифры табло, строка дня) с тестами; DOM-слои (комната, питомец, экран) поверх них. Мир 2800×1575 в сцене 1920×1080, камера — `transform` мира. Рейтинги — те же блоки `RankingPanel`, разложенные по доскам. `PetView`, `room.css` и страница РГ не меняются.

**Tech Stack:** Vite + TypeScript, DOM/SVG, Vitest, Playwright (`tools/check-*.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-01-tv-screen-design.md`

## Global Constraints

- Контракт DOM проверок не ломается (список в спеке, «Ограничения»); `npm run check:render`, `check:admin`, `check:dist` зелёные.
- Прокрутки нет: `scrollHeight ≤ innerHeight` и `scrollWidth ≤ innerWidth` на 1920×1080 и 1366×768.
- В `idle` нет таймеров движения и rAF; число узлов DOM не растёт со временем (эмоции и руки удаляются).
- Тексты по-русски, даты `ДД.ММ`, время по Москве.

## Review Focus

1. Первый день (02.11) на пустой таблице: шесть яиц, доски «Пока никого», нет ошибок консоли.
2. Шесть вылупившихся, шесть надгробий, ноль питомцев — нет падений в блуждании и табло.
3. Смена снимка посреди движения питомца: состояние (яйцо → питомец, смерть) применяется, старый цикл блуждания останавливается.
4. Скрытая вкладка и возврат: движение возобновляется, камера не «прыгает» серией переходов.
5. Длинные ФИО и 12+ сотрудников в группе не вылезают за доску.

---

### Task 1: Чистая логика экрана

**Files:**
- Create: `src/game/tv/layout.ts`, `src/game/tv/schedule.ts`, `src/game/tv/metrics.ts`
- Test: `src/game/tv/schedule.test.ts`, `src/game/tv/metrics.test.ts`
- Modify: `src/engine/pet.ts` (экспорт `HATCH_AT`), `src/engine/ranking.ts` (`RankRow.facts` у героев), `src/engine/ranking.test.ts`

**Interfaces — Produces:**
- `layout.ts`: `WORLD = {w:2800,h:1575}`, `STAGE = {w:1920,h:1080}`, `HOUSE = {x:600,y:40}`, `ROOM = {w:529,h:446}`, `roomRect(i): {x,y,w,h,floorY,cx,row}` (как в макете), `BOARDS = {heroes:{x:70,y:120}, group:{x:2260,y:120}}` (470×780), `CAMERA: Record<Shot, string>` (`overview`, `rooms` — из макета; `heroes`, `group` — доска целиком под строкой 64 px).
- `schedule.ts`: `type Shot = 'overview'|'rooms'|'heroes'|'group'`; `CYCLE = [['rooms',25000],['heroes',12000],['group',18000]]`; `SLIDE_MS = 6000`; `shotAt(ms: number): { shot: Shot; slide: number }` — `slide` — сквозной номер слайда правой доски (растёт на 3 за проход цикла, внутри «group» +1 каждые 6 с).
- `metrics.ts`: `tickerItems(s: PetState, funnel?: {quality:number; long:number}): {label:string; value:string; unit?:string}[]` (4 пункта для питомца, 1 для яйца/надгробия); `groupFunnel(rank: RankData, asOf: DateStr): Record<GroupCode,{quality:number;long:number}>`; `dayLine(asOf: DateStr, cfg: Config): string`; `freshLine(o:{at: Date; funnelThrough: DateStr|null; paymentsThrough: DateStr|null}): string`.
- `ranking.ts`: `RankRow.facts?: {quality:number; long:number; normQuality:number; normLong:number}` — заполняет только `heroesOfDay`.

- [ ] **Step 1: тесты** — `shotAt(0)` → `{shot:'rooms', slide:0}`; `shotAt(25000)` → `heroes`; `shotAt(37000)` → `{group, slide:0}`, `shotAt(43000)` → slide 1, `shotAt(49000)` → slide 2; `shotAt(55000)` → `{rooms, slide:3}`; `shotAt(-5)` и `NaN` не бросают (→ rooms). `dayLine`: `2026-11-01` → «старт 02.11»; `2026-11-02` → «день 1 из 14»; `2026-11-07` → «выходной · день 4 из 14»; `2026-11-20` → «день 14 из 14»; `2026-11-23` → «игра окончена». `freshLine` → «обновлено 10:42 · воронка по 11.11 · оплаты по 11.11», без воронки «воронки ещё нет». `tickerItems`: питомец стадии 7 → `[Стадия 7/15, Оплат, Качественных счетов, Длинных презентаций]`, без `funnel` — два пункта; яйцо с 3 оплатами → «До вылупления» «3» «из 5 оплат»; надгробие → один пункт. `groupFunnel`: строки воронки суммируются по группе сотрудника на дату строки, строки после `asOf` не считаются. `heroesOfDay` отдаёт `facts` (кач 6 при норме 5 → `quality:6, normQuality:5`).
- [ ] **Step 2:** `npx vitest run src/game/tv src/engine/ranking.test.ts` — FAIL.
- [ ] **Step 3:** реализация.
- [ ] **Step 4:** PASS. **Step 5:** commit `feat: логика экрана ТВ — геометрия, камера, табло, строка дня`.

### Task 2: Арт болванок

**Files:**
- Create: `public/assets/pets/sr1.svg` … `sr9.svg` (персонажи макета `petSVG`, шарф цвета группы), `src/game/tv/art.ts`
- Modify: `src/art/manifest.ts` (`ART.pets` → `.svg`; `THEME: Record<GroupCode,{species,accent,wall:[string,string],floor,decor}>` — значения из макета `G`), `CREDITS.md`

**Interfaces — Produces:** `THEME`; `art.ts`: `DECOR: Record<string,string>` (внутренность `<svg viewBox="0 0 529 340">` из макета), `EMOTE: Record<'ok'|'sad'|'bored'|'sick'|'joy', string>` (SVG-разметка значков 40×40).

- [ ] **Step 1:** файлы и пути; `npm run check:render` — «не загрузились картинки» пусто.
- [ ] **Step 2:** commit `feat: болванки питомцев правильных видов и темы комнат`.

### Task 3: Комнаты, питомцы, доски, камера

**Files:**
- Create: `src/game/tv/RoomView.ts`, `src/game/tv/PetActor.ts`, `src/game/tv/TvScreen.ts`, `src/game/tv/tv.css`
- Modify: `src/game/RankingPanel.ts` (возвращает блоки, `pickGroup`, факты героев), `src/main.ts`

**Interfaces:**
- Consumes: Task 1, Task 2.
- `RankingPanel.mountRanking(get, opts) → { blocks: {group:HTMLElement; top:HTMLElement; heroes:HTMLElement}; update(): void; pickGroup(g: GroupCode): void }` (больше не рисует в `root`).
- `RoomView(group, index)`: `.el` = `[data-group]` в координатах дома; `update(s: PetState, funnel?)`; `playHand(item, x)`; `tick()` — следующий пункт табло.
- `PetActor(group, room)`: картинка в слое мира; `update(s)` — спрайт (`eggs/pets/grave`), размер `150 * petScale(stage)`; `start()`/`stop()` — блуждание и мяч (только `phase:'pet'` и жив); `x` — текущая точка.
- `mountTv(root, o: { states: () => Record<GroupCode,PetState>; rank?: () => RankData; asOf: () => DateStr; fresh?: () => string }) → { update(): void; playHand(g, item): void; setPower(m: PowerMode): void }`.

- [ ] **Step 1:** `RankingPanel` — блоки отдельно; у героев под ФИО `span.facts` «кач 6/5 · длин 3/3» (вне `.name`). `npx vitest run src/game` — PASS.
- [ ] **Step 2:** `RoomView` + `PetActor` + `TvScreen` + `tv.css` по макету; `fit()` на `resize`; камера: `setPower('active')` → `overview`, `ambient` → `shotAt(now - cycleStart)` раз в секунду, `pickGroup(GROUPS[slide % 7])` или слайд «Топ-10» (`slide % 7 === 6`), `idle` → стоп всего движения.
- [ ] **Step 3:** `main.ts` — демо и живой экран через `mountTv`; `[role="status"]` и «Игра ещё не запущена» как раньше; `power.onTick(mode => tv.setPower(mode); tv.update())`.
- [ ] **Step 4:** браузер: `?demo=1`, мок `?backend=…&asOf=2026-11-12` и `asOf=2026-11-02`; консоль без ошибок; 1920×1080 и 1366×768 без прокрутки; один скриншот для сверки с макетом.
- [ ] **Step 5:** commit `feat: экран ТВ — домик из шести комнат и зал с досками`.

### Task 4: Две мелочи админки к первому дню

**Files:** Modify `src/data/api.ts` (`post` — таймаут 30 с, `get` — 10 с), `src/admin/session.ts` + `src/admin/main.ts` (при `locked` посреди работы — экран входа с `errorText(e)`, а не «Сессия закончилась»); тесты `src/data/api.test.ts`, `src/admin/session.test.ts`.

- [ ] **Step 1:** тесты: `post` не обрывается на 10 с и обрывается на 30 с (фейковые таймеры); `onLogout` получает ошибку `locked`. FAIL → реализация → PASS.
- [ ] **Step 2:** commit `fix: запись в админке ждёт 30 с, блокировка входа называется блокировкой`.

### Task 5: Проверки и выпуск

**Files:** Modify `tools/check-render.mjs` (прокрутка на 1920×1080 и 1366×768; `asOf=2026-11-01` — шесть `egg0`, «старт 02.11»; надгробие СР9 на `2026-11-11` в демо видно как картинка `grave`), `PLAN.md`, `.claude/skills/game-architecture/SKILL.md`.

- [ ] **Step 1:** `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `check:render`, `check:admin`, `check:dist` через `log-reader` — всё зелёное.
- [ ] **Step 2:** ревью ветки субагентом `reviewer`; исправить Critical/Important.
- [ ] **Step 3:** `PLAN.md` и скилл архитектуры; `graphify update .`; commit. Выкладка (`git push`) — только после «да» заказчика.
