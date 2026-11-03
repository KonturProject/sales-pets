# Итоги, правки фактов, дробные нормы, выходные — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дробные нормы воронки, вкладка «Итоги» (группы → сотрудники, план/факт за день и с начала игры), ручные правки фактов воронки и оплат, разбор последствий при загрузке файлов, выходные из админки.

**Architecture:** Сервер (Apps Script) хранит правки отдельным листом и календарь в `config.nonWorking`. Клиент накладывает правки и календарь в одном месте (`buildFacts` через `effectiveFacts`), поэтому ТВ, РГ, рейтинги и админка считают одинаково. «Итоги» и разборы — чистые функции над снимком (с тестами) плюс тонкий DOM-слой.

**Tech Stack:** TypeScript, Vite, Vitest, Playwright (`tools/check-*.mjs`), Google Apps Script (`apps-script/Code.gs`, тесты в `apps-script/test/` через `gas-harness.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-03-admin-results-design.md` (дополняет `docs/superpowers/specs/2026-10-25-tamagochi-design.md`).

## Global Constraints

- Сначала `graphify query "<вопрос>"` (`~/.local/bin/graphify.exe`), потом grep и чтение файлов. Устройство проекта — скилл `.claude/skills/game-architecture/SKILL.md`.
- Период игры: `GAME_START = '2026-11-02'`, `GAME_END = '2026-11-22'` (совпадают с `defaultConfig.startDate/endDate`).
- Нормы `quality`, `long`, `payments`: число 0…50, не больше двух знаков после запятой; на сервере и клиенте одна проверка.
- Правка: `kind ∈ {quality, long, payments}`, `delta` — целое ≠ 0, |delta| ≤ 50; `base` — целое 0…10000; в запросе 1…3 записи; всего записей ≤ 2000; дата в периоде игры и строго раньше «сегодня» сервера; сотрудник есть в штате.
- `nonWorking`: не больше 21 даты, без повторов, каждая в периоде игры; хранится отсортированной.
- PIN никогда не попадает в URL, репозиторий, localStorage, sessionStorage и консоль; у поля PIN нет `name`. В `sessionStorage` можно класть только номер сборки (задача 3).
- В тестах и проверках только вымышленные ФИО. Реальных ФИО и xlsx в репозитории нет (`npm run audit:publish`).
- Никаких записей на живой бэкенд (`https://script.google.com/...`). Все проверки — на моке (`tools/mock-backend.mjs` исполняет настоящий `Code.gs`).
- В git добавлять только явными путями. Не коммитить `.claude/settings.json`, `rooms-and-walk.html`, `work/`, `assets/_raw/`. Сообщение коммита: `feat|fix|docs: <по-русски>` и последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Стиль: как в соседнем коде — короткие комментарии по-русски, чистая логика отдельно от DOM, тесты рядом с кодом (`*.test.ts`), алиас `@/`.
- Показ чисел: дробное с запятой («1,5»), целое без «,0» (`ruNum` из задачи 2).

## Review Focus

1. Сотрудник переведён в другую группу посреди игры: правка оплаты идёт группе на дату правки (`groupOn`), а не текущей; в «Итогах» строка сотрудника в группе дня. Тест: задача 4 (`facts.test.ts`) и задача 5.
2. День после `funnelThrough` или выходной: правка воронки не влияет на оценку, пока день не загружен или пока он выходной; «Итоги» пишут причину. Тест: задачи 4 и 5.
3. Отрицательная правка больше значения файла: факт не уходит ниже 0 ни у сотрудника, ни у группы, ни в рейтинге. Устаревание (`base ≠ из файла`) срабатывает и когда файл потом **уменьшил** значение. Тест: задачи 4 и 5.
4. Снимок старого сервера (нет `corrections`) и испорченный `config.nonWorking` (строки-мусор, даты вне периода, повторы, не массив): расчёт идёт по умолчанию, ничего не падает. Тест: задачи 2 и 4.
5. Уволенные, ещё не принятые и скрытые из рейтинга: в строках «Итогов» видны по правилам спеки; правка оплаты скрытого не попадает в рейтинг, но идёт группе. Тест: задачи 4 и 5.

---

### Task 1: Сервер v4 — дробные нормы, выходные, правки фактов

**Files:**
- Modify: `apps-script/Code.gs` (константы, `SHEETS`, `mergeNorms_`, новые действия, `ACTIONS_`, `doGet`)
- Modify: `apps-script/README.md` (таблица действий)
- Test: `apps-script/test/backend.test.mjs`, `apps-script/test/config-parity.test.mjs`

**Interfaces:**
- Produces (протокол):
  - `setNonWorking {pin, nonWorking: DateStr[]}` → `{ok, version, nonWorking}`; пишет `config.nonWorking` (сортировка по дате) в `Settings.config`.
  - `addCorrections {pin, items: {date, employeeId, kind, delta, base}[], ref}` → `{ok, version, ids: number[]}`; повтор `ref` → `{ok, version (текущая), ids, duplicate: true}`.
  - `removeCorrection {pin, id}` → `{ok, version, removed: 1}` или `{ok, version (текущая), removed: 0}`.
  - GET: `corrections: {id: number, date, employeeId, kind, delta: number, base: number}[]`; `config.nonWorking` отдаётся как сохранён.
  - Лист `Corrections`: `['id', 'date', 'employeeId', 'kind', 'delta', 'base', 'ref']`; `id` — max+1.

- [ ] **Step 1: Тесты (падают).** В `backend.test.mjs` новые `describe`:
  - `'Дробные нормы'`: `setConfig {norms: {experienced: {long: 1.5, quality: 2.25}}}` → ok, в GET `config.norms.experienced.long === 1.5`; `long: 1.555` → `bad_request`; `long: 50.01` → `bad_request`.
  - `'Выходные'`: `setNonWorking {nonWorking: ['2026-11-07','2026-11-04']}` → ok, GET `config.nonWorking` = `['2026-11-04','2026-11-07']`; дата вне периода (`'2026-11-23'`), повтор, не массив, 22 даты, мусорная строка → `bad_request`; после `setConfig {maxPiles: 3}` список на месте; `setConfig {nonWorking: [...]}` → `bad_request`; без PIN админа → `invalid_pin`.
  - `'Правки фактов'`: добавление трёх записей одним запросом → три `id` по порядку, GET `corrections` с `base`, без `ref`; повтор того же `ref` → `duplicate: true`, те же `ids`, версия не растёт, записей не прибавилось; одна плохая запись из трёх (`delta: 0` / `delta: 51` / `delta: 1.5` / `kind: 'toys'` / неизвестный сотрудник / дата `'2026-11-12'` = сегодня / `'2026-11-01'` / `base: -1` / пустой `items` / 4 записи / `ref` пустой или > 64) → `bad_request` и **ничего** не записано; 2001-я запись → `bad_request`; `removeCorrection` удаляет (`removed: 1`, версия +1), повтор → `removed: 0`, версия та же; `removeCorrection {id: 'x'}` → `bad_request`; PIN группы → `invalid_pin`.
  - В `config-parity.test.mjs`: дробные `quality`/`long` проходят одинаково на сервере и в `applyPatch`/`configOf` клиента; `nonWorking` в `config` переживает `setConfig` и `applyPatch` клиента.
- [ ] **Step 2:** `npx vitest run apps-script/test` → новые тесты FAIL (нет действий / `bad_request` на дроби).
- [ ] **Step 3: Реализация.** `isNorm_` (0…50, ≤ 2 знаков) вместо `isPaymentsNorm_` для всех полей нормы; константы из Global Constraints; `setNonWorkingAction_`, `addCorrectionsAction_` (проверка всех записей до записи, `withLock_` как у прочих), `removeCorrectionAction_`; `doGet` отдаёт `corrections`; `ACTIONS_` — все три `who: 'admin'`. Комментарий над `CONFIG_RANGES` поправить: календарь правится только `setNonWorking`.
- [ ] **Step 4:** `npx vitest run apps-script/test` → PASS; затем `npm test` целиком → PASS.
- [ ] **Step 5:** README: строки трёх действий в таблице, `quality`/`long` дробные. Коммит: `git add apps-script/Code.gs apps-script/README.md apps-script/test/backend.test.mjs apps-script/test/config-parity.test.mjs` → `feat: сервер v4 — дробные нормы, выходные, правки фактов`.

### Task 2: Клиент — дробные нормы, календарь из настроек, показ чисел

**Files:**
- Create: `src/engine/format.ts` (+ `format.test.ts`)
- Modify: `src/engine/evaluate.ts`, `src/data/config.ts`, `src/data/api.ts` (`SnapshotConfig.nonWorking?`), `src/admin/configForm.ts`, `src/admin/configPreview.ts`, `src/game/RankingPanel.ts`
- Test: `src/engine/evaluate.test.ts`, `src/data/config.test.ts`, `src/admin/configForm.test.ts`, `src/admin/configPreview.test.ts`

**Interfaces:**
- Consumes: протокол задачи 1 (`config.nonWorking`, дробные нормы).
- Produces: `ruNum(n: number): string` («1,5», «2», «0,25»); `configOf` разбирает `nonWorking` (только база, не записи «с даты»); `DayResult.normQuality/normLong` могут быть дробными, сравнение в целых сотых.

- [ ] **Step 1: Тесты (падают).**
  - `evaluate.test.ts`: семеро опытных с нормой длинных 1,5 → `normLong === 10.5`; факт 10 → `longMet === false`, факт 11 → `true`; три человека с нормой 0,1 → `normQuality === 0.3` ровно и факт 0 → `qualityMet === false` (`longRequired` при норме длинных 0,1 — `true`).
  - `config.test.ts`: `configOf({norms: {experienced: {long: 1.5}}})` даёт 1,5; `long: 1.555` → норма по умолчанию; `configOf({nonWorking: ['2026-11-05','2026-11-04']})` → `['2026-11-04','2026-11-05']`; мусор (`'x'`, `'2026-11-31'`, `'2026-11-30'`, повтор, не массив, 22 даты) → встроенный календарь; `timelineOf` с записью «с даты», где есть `nonWorking`, календарь не меняет.
  - `configForm.test.ts`: «1,5» и «0.25» для качественных/длинных принимаются; «1,555» — ошибка с названием поля.
  - `configPreview.test.ts`: `mergeConfig({nonWorking: [...] , maxPiles: 2}, {maxPiles: 3})` сохраняет `nonWorking`; `describeEntry` пишет «длинные 1,5».
  - `format.test.ts`: `ruNum(1.5) === '1,5'`, `ruNum(2) === '2'`, `ruNum(0.25) === '0,25'`.
- [ ] **Step 2:** `npx vitest run src/engine src/data src/admin` → новые тесты FAIL.
- [ ] **Step 3: Реализация.** `evaluateDay` копит нормы в сотых (`Math.round(n * 100)`), `normQuality = cents / 100`, выполнено при `fact * 100 >= cents`; `isNorm` для трёх полей в `data/config.ts`; разбор `nonWorking` только в базе; форма норм — `hundredths` для трёх полей, показ через `ruNum` (`ruNumber` из `configForm.ts` заменить на `ruNum`); подпись героев дня в `RankingPanel.ts` через `ruNum`.
- [ ] **Step 4:** `npm test` → PASS; `npm run build` → OK; `npm run check:admin` → OK (форма норм).
- [ ] **Step 5:** Коммит явными путями: `feat: дробные нормы качественных и длинных, календарь из настроек`.

### Task 3: Номер сборки и самообновление страниц

**Files:**
- Modify: `vite.config.ts` (плагин: `define.__BUILD_ID__`, файл `version.json` в сборке), `src/vite-env.d.ts` (или где объявлены глобалы)
- Create: `src/data/build.ts` (+ `build.test.ts`)
- Modify: `src/main.ts` (живой экран ТВ), `src/rg/main.ts`, `src/admin/main.ts`, `src/admin/admin.css`
- Modify: `tools/check-dist.mjs` (в сборке есть `version.json`, его `build` совпадает со вшитым)

**Interfaces:**
- Produces: `__BUILD_ID__: string` (в dev — `'dev'`); `version.json` = `{"build": "<id>"}`; `decideReload(current: string, fetched: string | null, lastReload: {build: string; at: number} | null, now: number): boolean` — `true`, если `fetched` есть, отличается от `current` и для этого `fetched` перезагрузки не было последние 15 мин; `watchBuild(onNew: (build: string) => void, everyMs = 300_000): () => void` — опрос `version.json?t=<now>` с `cache: 'no-store'`, в dev ничего не делает, ошибки сети молча пропускает.

- [ ] **Step 1: Тесты (падают).** `build.test.ts`: тот же номер → `false`; новый номер → `true`; новый номер, перезагрузка на него 5 мин назад → `false`, 16 мин назад → `true`; `fetched === null` → `false`.
- [ ] **Step 2:** `npx vitest run src/data/build.test.ts` → FAIL.
- [ ] **Step 3: Реализация.** ТВ: при новом номере и `decideReload` → записать `{build, at}` в `sessionStorage` (`try/catch`) и `location.reload()`. РГ: то же, но не во время переноса предмета и не во время записи (отложить до конца). Админка: плашка «Вышла новая версия — обновите страницу» над вкладками, без перезагрузки. Демо (`?demo=1`) не опрашивает.
- [ ] **Step 4:** `npm test`, `npm run build` (в `dist/version.json` есть номер), `npm run check:dist` → OK.
- [ ] **Step 5:** Коммит: `feat: номер сборки — ТВ и страница РГ сами обновляются на новую версию`.

### Выпуск 1 (делает контроллер)

После ревью задач 1–3: `Code.gs` v4 в Apps Script через Chrome (новая версия того же развёртывания; при экране входа или «Review permissions» — остановиться и уведомить владельца); `node tools/smoke-live.mjs` / `npm run smoke-live` (только чтение), в GET есть `corrections: []`; затем `git push origin tv-screen:master tv-screen`, дождаться Pages, `node tools/check-live.mjs https://konturproject.github.io/sales-pets/ --backend`, в живых бандлах есть `version.json`. Уведомить владельца: открытые ТВ и страницы РГ обновить один раз (F5).

### Task 4: Правки фактов в расчёте (`buildFacts`, рейтинги, причина болезни)

**Files:**
- Modify: `src/data/api.ts` (`SnapshotCorrection`, `Snapshot.corrections?`), `src/data/facts.ts`, `src/engine/ranking.ts`, `src/engine/pet.ts`, `src/demo/*` (если тип требует поле)
- Test: `src/data/facts.test.ts`, `src/engine/ranking.test.ts`, `src/engine/pet.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SnapshotCorrection { id: number; date: DateStr; employeeId: string; kind: 'quality' | 'long' | 'payments'; delta: number; base: number }
  /** Факты снимка после правок: один источник для оценки, рейтингов, табло и «Итогов». Ключи `${employeeId}|${date}`, `${group}|${date}`. */
  export interface EffectiveFacts {
    funnel: FunnelDay[];                       // файл + правки, ≥ 0, все даты (отсечение по funnelThrough — у потребителя)
    fileFunnel: Map<string, { quality: number; long: number }>;
    paymentsByDay: Record<GroupCode, Record<DateStr, number>>; // файл (уникальные счета) + предварительные + правки, ≥ 0
    fileInvoices: Map<string, number>;         // уникальные счета сотрудника за день по автору (из файла)
    unmatched: Map<string, number>;            // оплаты авторов не из штата по группе и дню
    rankPayments: PaymentRow[];
    paymentCorrections: { employeeId: string; date: DateStr; delta: number }[];
  }
  export function effectiveFacts(s: Snapshot): EffectiveFacts; // кэш на объект снимка
  ```
  `RankData.paymentCorrections?: {employeeId, date, delta}[]` — `countedPayments` прибавляет дельты дней окна, где `countsInRating`, в группу `groupOn(e, date)`, итог сотрудника по группе не ниже 0. `PetState.noPayDays: number` — рабочих дней подряд без оплат на `asOf` (тот же счёт, что ведёт к болезни; аптечка его обнуляет).

- [ ] **Step 1: Тесты (падают).** `facts.test.ts`:
  - правка `long +1` при факте 9 и норме 10 → у группы нет кучки (была бы), есть аптечка на следующий рабочий день;
  - правка `long −5` при факте 2 → факт 0, не −3;
  - правка за день после `funnelThrough` не меняет состояние, пока `funnelThrough` не дойдёт до дня;
  - правка `payments +1` сотруднику, переведённому в СР2 с этой даты, идёт СР2, а не прежней группе;
  - правка `payments −1` больше оплат группы за день → 0 оплат, не отрицательно;
  - снимок без `corrections` считается как раньше (все прежние тесты зелёные);
  - `rank.funnel` и табло (`groupFunnel`) включают правки.
  `ranking.test.ts`: правка оплаты попадает в `groupRanking` и `topOverall`; скрытому из рейтинга и отсутствующему в этот день — не попадает; минус больше засчитанного → 0. `pet.test.ts`: `noPayDays` = 2 после двух рабочих дней без оплат, 0 после аптечки.
- [ ] **Step 2:** `npx vitest run src/data src/engine` → FAIL.
- [ ] **Step 3: Реализация.** Вынести сбор оплат и воронки из `compute()` в `effectiveFacts`; `compute()` берёт оттуда всё, отсечение `≤ funnelThrough` — после правок; `RankData` получает `paymentCorrections`; `simulate` возвращает `noPayDays`.
- [ ] **Step 4:** `npm test` → PASS; `npm run check:render` → OK.
- [ ] **Step 5:** Коммит: `feat: правки фактов воронки и оплат в расчёте питомцев и рейтингов`.

### Task 5: «Итоги» — чистая логика

**Files:**
- Create: `src/admin/results.ts`, `src/admin/results.test.ts`

**Interfaces:**
- Consumes: `effectiveFacts`, `buildFacts`, `evaluateDay`, `paymentPlanCents`, `groupPlan`, `timelineOf`, `THEME` (имя героя), `SnapshotCorrection`.
- Produces:
  ```ts
  export type Kind = 'quality' | 'long' | 'payments';
  export interface Cell { fact: number; plan: number | null; corrected: number; stale: boolean } // plan null — плана нет; corrected — сумма правок в fact
  export type Outcome =
    | { evaluated: true; result: DayResult; medkit: boolean; pile: boolean; pileRemoved: boolean; toy: boolean; appliesOn: DateStr | null }
    | { evaluated: false; reason: 'weekend' | 'no-funnel' };
  export interface EmployeeLine { id: string; name: string; level: Level; absence: Absence['kind'] | null; inGroupTotal: boolean; hidden: boolean;
    day: Record<Kind, Cell>; total: Record<Kind, Cell>; file: Record<Kind, number>; current: Record<Kind, number> }
  export interface GroupLine { group: GroupCode; hero: string; day: Record<Kind, Cell>; total: Record<Kind, Cell>; gamePlanPercent: number | null;
    outcome: Outcome; now: PetState; nowReason: string | null; employees: EmployeeLine[]; unassigned: { payments: number; unmatched: number } }
  export function resultsDays(s: Snapshot): { date: DateStr; working: boolean }[];   // дни игры с 02.11 по вчера сервера
  export function defaultResultsDay(s: Snapshot): DateStr;
  export function dayResults(s: Snapshot, date: DateStr): GroupLine[];
  export interface CorrectionView { c: SnapshotCorrection; group: GroupCode; name: string; fileNow: number | null; stale: boolean }
  export function correctionViews(s: Snapshot): CorrectionView[];                   // новые сверху
  export interface CorrectionItem { date: DateStr; employeeId: string; kind: Kind; delta: number; base: number }
  export function correctionItems(line: EmployeeLine, wanted: Record<Kind, number>, date: DateStr): CorrectionItem[] | { error: string };
  export function moodReason(state: PetState, cfg: Config, yesterdayPayments: number | null): string | null;
  ```
  Определения — раздел 3 спеки. `fileNow` для воронки — `null`, если день позже `funnelThrough`; для оплат — `null`, если день позже `paymentsImportedThrough`. Оплаты «за день» рабочего дня — корзина движка (после предыдущего рабочего дня по D включительно), `Cell` оплат получает `weekend: number` — сколько из факта пришло в выходные. Накопленный факт воронки группы — `groupFunnel` (`src/game/tv/metrics.ts`) над `effectiveFacts`, тот же, что на табло ТВ; план — нормы за оценённые рабочие дни ≤ D. Пустой `nonWorking: []` — «выходных нет». Для новых сотрудников в разборе (id `new:<n>`) «Поправить» недоступна.

- [ ] **Step 1: Тесты (падают)** на вымышленном снимке (штат из 3–4 человек в двух группах):
  - строка группы: план и факт трёх показателей за день совпадают с `evaluateDay`/`paymentPlanCents`/`paymentsByDay`;
  - `outcome` для дня с недобором длинных: `pile: true`, `appliesOn` = следующий рабочий день; для субботы — `{evaluated: false, reason: 'weekend'}`; для дня после `funnelThrough` — `'no-funnel'`;
  - накопление: факт и план воронки только по оценённым дням ≤ D; оплаты — все даты ≤ D;
  - сотрудник в отпуске: `absence: 'vacation'`, `inGroupTotal: false`, план 0; уволенный до D и принятый после D — не в списке; скрытый — `hidden: true`;
  - `unassigned.payments` = факт группы − сумма сотрудников, `unassigned.unmatched` — авторы не из штата;
  - `correctionViews`: правка с `base: 2`, в файле теперь 3 → `stale: true`; файл уменьшил до 1 → `stale: true`; день не загружен → `fileNow: null, stale: false`;
  - `correctionItems`: хочу 3 при текущем 2 и файле 2 → `[{kind, delta: 1, base: 2}]`; ничего не изменилось → `[]`; отрицательное → ошибка; воронка у отсутствующего → ошибка;
  - `moodReason`: болезнь по дням без оплат, болезнь по кучкам, грусть, скука, погиб, `ok` → `null`;
  - `defaultResultsDay`: последний рабочий ≤ `funnelThrough` и ≤ вчера; без воронки — вчерашний день игры.
- [ ] **Step 2:** `npx vitest run src/admin/results.test.ts` → FAIL.
- [ ] **Step 3: Реализация** в `src/admin/results.ts` без DOM, только из функций движка и `effectiveFacts` (своих копий правил нет).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Коммит: `feat: итоги дня по группам и сотрудникам — чистая логика`.

### Task 6: Вкладка «Итоги», правка и список правок

**Files:**
- Create: `src/admin/resultsTab.ts`, `src/admin/resultsView.ts` (таблица группы с раскрытием и редактор правки — переиспользуется в задаче 7)
- Modify: `src/admin/main.ts` (вкладка «Итоги» первой), `src/admin/admin.css`
- Modify: `tools/check-admin.mjs` (сценарии)

**Interfaces:**
- Consumes: задача 5; `ctx.session.call('addCorrections' | 'removeCorrection', ...)`, `ctx.snapshot()`.
- Produces: `renderResults(lines: GroupLine[], opts: { date: DateStr; open: Set<GroupCode>; onCorrect?: (line: EmployeeLine, wanted: Record<Kind, number>) => Promise<void> }): HTMLElement` — таблица (строка группы — кнопка раскрытия с `aria-expanded`), ячейки «факт / план» с ✓/✗, отметки правок и устаревших правок, редактор «Поправить» (три поля, подписи «из файла N, правки +K», «Сохранить»/«Отмена», ошибки в `role="alert"`). `ref` для `addCorrections` — `crypto.randomUUID()` с запасным вариантом.

- [ ] **Step 1: Сценарии `check-admin.mjs` (падают):** вкладка «Итоги» открывается первой, день по умолчанию — последний оценённый; раскрытие группы показывает сотрудников; «Поправить» длинные +1 у сотрудника → итог дня группы меняется с «+1 кучка» на «аптечка», в списке правок появилась запись; «Отменить» → вернулось; повторный клик «Сохранить» во время записи не создаёт вторую правку; раскрытая группа остаётся раскрытой после обновления данных.
- [ ] **Step 2:** `npm run check:admin` → FAIL.
- [ ] **Step 3: Реализация.** Узкий экран: таблица в контейнере с горизонтальной прокруткой, без прокрутки страницы. Числа — `ruNum`.
- [ ] **Step 4:** `npm test`, `npm run build`, `npm run check:admin`, `npm run check:dist` → OK.
- [ ] **Step 5:** Коммит: `feat: вкладка «Итоги» — план и факт по группам и сотрудникам, ручные правки`.

### Выпуск 2 (контроллер)

После ревью задач 4–6: push, Pages, `check-live --backend`. Сервер уже v4.

### Task 7: Разбор при загрузке воронки и оплат

**Files:**
- Modify: `src/admin/importPlan.ts` (+ тесты), `src/admin/importTab.ts`, `tools/check-admin.mjs`
- Create: `src/admin/effects.ts` (+ `effects.test.ts`) — «что изменится» между двумя снимками

**Interfaces:**
- Produces:
  ```ts
  /** Снимок «как будто файл воронки загружен» — зеркало importFunnel и setStaff сервера; новые сотрудники с id `new:<n>`. */
  export function withFunnelImport(s: Snapshot, plan: FunnelPlan): Snapshot;
  /** Зеркало importPayments: период заменён, предварительные числа периода убраны, paymentsImportedThrough = max. */
  export function withPaymentsImport(s: Snapshot, plan: PaymentsPlan): Snapshot;
  export interface Effects { days: { group: GroupCode; date: DateStr; before: string; after: string }[]; now: GroupChange[]; stale: CorrectionView[] }
  /** Изменения оценок оценённых дней, питомцев на сегодня и устаревшие правки после перехода before → after. */
  export function effectsOf(before: Snapshot, after: Snapshot): Effects;
  ```
- Consumes: `renderResults` (задача 6), `dayResults`, `correctionViews`, `describeChange` из `configPreview.ts`.

- [ ] **Step 1: Тесты (падают).** `importPlan.test.ts`: `withFunnelImport` заменяет строки по паре «сотрудник, день», `funnelThrough = through`, новые сотрудники в своей группе опытными; `withPaymentsImport` заменяет период и убирает предварительные числа периода. `effects.test.ts`: файл поднял длинные за прошлый день → строка «СР1 03.11: +1 кучка → аптечка»; правка с `base` 2, в файле 3 → в `stale`; ничего не изменилось → пустые списки. `check-admin.mjs`: после выбора файла воронки видна таблица за день файла с итогом каждой группы; «Поправить» в разборе пишет правку и пересчитывает разбор, «Загрузить» остаётся; для оплат — таблица и «Сейчас станет».
- [ ] **Step 2:** `npx vitest run src/admin` и `npm run check:admin` → FAIL.
- [ ] **Step 3: Реализация.** Разбор воронки: таблица за `through` по `withFunnelImport`, «Изменятся итоги прошлых дней», «Сейчас станет», устаревшие правки; «Поправить» — `base` и «текущее» из снимка после загрузки, после записи — свежий снимок и пересчёт с тем же файлом. Оплаты — то же за `plan.to`.
- [ ] **Step 4:** `npm test`, `npm run check:admin`, `npm run build` → OK.
- [ ] **Step 5:** Коммит: `feat: разбор при загрузке — кто что получит, что изменится, устаревшие правки`.

### Task 8: Выходные из админки

**Files:**
- Modify: `src/admin/normsTab.ts` (блок «Выходные дни»), `src/admin/admin.css`, `tools/check-admin.mjs`
- Create: `src/admin/calendarForm.ts` (+ тесты) — сетка дней и превью

**Interfaces:**
- Produces: `calendarWeeks(cfg: Config): { date: DateStr; off: boolean }[][]` (пн–вс, дни вне периода — пустые); `calendarPreview(s: Snapshot, nonWorking: DateStr[]): Effects` (через `effectsOf`, после = `{...s, config: {...s.config, nonWorking}}`).
- Consumes: `setNonWorking` (задача 1), `effectsOf` (задача 7).

- [ ] **Step 1: Тесты (падают).** `calendarForm.test.ts`: 02.11.2026 — понедельник первой строки, три недели; встроенные выходные отмечены; превью: сделать рабочим прошлый выходной с загруженными нулями → в `days` появляется «+1 кучка». `check-admin.mjs`: переключить 05.11 в выходной → превью → «Сохранить» → блок «Сегодня» и календарь показывают новый выходной; вернуть.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализация** по разделу 5 спеки.
- [ ] **Step 4:** `npm test`, `npm run check:admin`, `npm run check:render`, `npm run build` → OK.
- [ ] **Step 5:** Коммит: `feat: выходные дни из админки с превью последствий`.

### Task 9: Документы и граф

**Files:** `docs/superpowers/specs/2026-10-25-tamagochi-design.md` (нормы дробные, календарь правится, правки фактов — ссылка на новую спеку), `.claude/skills/game-architecture/SKILL.md` (results, effects, build, правки в `effectiveFacts`), `PLAN.md`, `graphify-out/` (`~/.local/bin/graphify.exe update .`).

- [ ] **Step 1:** Правки документов; `npm run audit:publish` → только прежний базовый FAIL по двум старым файлам истории.
- [ ] **Step 2:** `graphify update .`; коммит документов и графа отдельными коммитами.

### Финал (контроллер)

Финальное ревью всей ветки субагентом `reviewer` (Opus 5.5, xhigh), исправления Critical/Important с тестом RED→GREEN, затем Выпуск 3 (push, Pages, `check-live --backend`), `PLAN.md`, уведомление владельцу.
