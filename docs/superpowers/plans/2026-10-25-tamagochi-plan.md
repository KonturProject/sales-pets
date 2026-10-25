# Тамагочи отделов продаж — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Браузерная игра на GitHub Pages: шесть питомцев отделов продаж растут от оплат и реагируют на выполнение норм, с админкой, страницей РГ и бэкендом на Apps Script.

**Architecture:** Бэкенд хранит только **факты** (оплаты по дням, воронка по сотрудникам и дням, штат с датами, отсутствия, ручные правки, настройки, PIN). Вся игровая логика — чистые TS-функции `facts → состояние` (движок), которые работают в браузере; пересчёт задним числом тривиален. Страницы: `index.html` (экран), `admin.html`, `rg.html`. Этап 1 (прототип) — движок + экран на демо-данных без бэкенда.

**Tech Stack:** Vite, TypeScript, Vitest, SVG/CSS/Canvas 2D (без Phaser), SheetJS 0.20.3 (импорт xlsx в браузере), Google Apps Script + Sheets, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-25-tamagochi-design.md` (разделы 4, 7а, 7б, 7в — правила; названия «7а–7в» ниже ссылаются на них).

## Global Constraints

- Группы и порядок на экране: `СР1, СР2, СР3, СР5, СР6, СР9`. Яйца: СР1 красное, СР2 зелёное, СР3 жёлтое, СР5 чёрное, СР6 фиолетовое, СР9 синее. Питомцы: СР1 львёнок, СР2 утёнок, СР3 цыплёнок, СР5 ягнёнок, СР6 сова, СР9 бегемот.
- Яйцо: оплата №1 — трещина, №3 — большая трещина, №5 — вылупление (накопительно за игру группы).
- Старт игры 2026-11-02 (пн), 3 недели; нерабочие: 2026-11-04, 07, 08, 14, 15, 21, 22. Часовой пояс Москва. Оценка в 11:00 за предыдущий рабочий день.
- Уровни сотрудников: `experienced` (5 качественных, из них 3 длинных), `rookie1` (1 качественный), `rookie2` (2 качественных и 1 длинный). Норма группы = сумма норм присутствующих. Длинные входят в качественные.
- Награды за день: норма длинных выполнена → +1 аптечка и −1 кучка; не выполнена → +1 кучка (макс. 5). Норма качественных выполнена → +1 игрушка. Запас без лимита.
- Скука: оплат группы за вчерашний рабочий день < 1 (настройка). Болезнь: 2 рабочих дня подряд без оплат ИЛИ кучек > 4 (настройки). Смерть: 5 рабочих дней подряд без оплат → через рабочий день новое яйцо; история сохраняется.
- 1 оплата = 1 уникальный «№ счета»; счета дешевле 100 ₽ не считаются.
- PIN: солёный хеш, 5 ошибок → блок 10 минут, PIN групп отдельные, показываются один раз, не в чате/URL/репозитории. Реальных ФИО в репозитории нет (только шаблон/демо-данные).
- Слабые устройства: PowerSaver (active / ambient 20 fps / idle 10 fps), без бесконечных твинов на неизменных значениях.
- Каждая загрузка ассета записывается в `CREDITS.md`. Тексты интерфейса — по-русски.

## Review Focus

1. Понедельник и день после праздника: «вчера» = последний рабочий день; тест на 2026-11-09 (пн после 7–8.11 → оценка за 2026-11-06).
2. Повторный импорт файла оплат за уже оценённый день: награды и кучки не удваиваются (результат идентичен первому импорту).
3. Пустые/неполные данные: группа без единой оплаты, сотрудник без строки в воронке, пустой файл — не падают, дают нули.
4. Дубли и мусор в файле оплат: повтор «№ счета», «Академия» 30 ₽, группа не из шести, незнакомый автор — отбрасываются/помечаются, не ломают импорт.
5. Статус сотрудника меняется задним числом (отпуск, увольнение, перевод): пересчитываются норма и награды затронутых дней, соседние дни не меняются.

---

## Этап 1 — Прототип (цель: сегодня–вторник 27.10)

### Task 1: Каркас проекта

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `.gitignore`, `README.md`
- Modify: `CLAUDE.md` (название, стек, команды `npm run dev|build|test`)

**Interfaces:** Produces: скрипты `dev`, `build`, `test` (vitest), алиас `@/` → `src/`.

- [ ] **Step 1:** `git init`; в `.gitignore`: `node_modules`, `dist`, `work/`, `sales-structure.json`, `*.xlsx`, `graphify-out/cache`.
- [ ] **Step 2:** Создать Vite+TS проект вручную (без шаблонных демо-файлов), добавить `vitest`, `typescript`.
- [ ] **Step 3:** Тест `src/smoke.test.ts`: `expect(1+1).toBe(2)`; `npm test` → PASS.
- [ ] **Step 4:** `npm run build` → успех; `npm run dev` отдаёт пустую страницу.
- [ ] **Step 5:** Обновить плейсхолдеры в `CLAUDE.md`; commit `chore: scaffold`.

### Task 2: Календарь и конфиг

**Files:** Create `src/engine/calendar.ts`, `src/engine/config.ts`; Test `src/engine/calendar.test.ts`

**Interfaces:** Produces:
- `type GroupCode = 'СР1'|'СР2'|'СР3'|'СР5'|'СР6'|'СР9'`, `const GROUPS: GroupCode[]`
- `type DateStr = string` (`yyyy-MM-dd`)
- `isWorkingDay(d: DateStr, cfg: Config): boolean`
- `prevWorkingDay(d: DateStr, cfg: Config): DateStr` (строго раньше `d`)
- `Config { startDate; endDate; nonWorking: DateStr[]; maxPiles; boredomBelow; sickDaysNoPay; sickPilesAbove; deathDaysNoPay; norms: Record<Level,{quality:number;long:number}>; stageThresholds: number[] }` и `defaultConfig`

- [ ] **Step 1:** Тесты: `isWorkingDay('2026-11-04')` false, `'2026-11-05'` true, `'2026-11-08'` false; `prevWorkingDay('2026-11-09')` = `'2026-11-06'`; `prevWorkingDay('2026-11-05')` = `'2026-11-03'`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Реализовать (даты как строки, без часовых поясов — парсинг через UTC). **Step 4:** PASS. **Step 5:** commit.

### Task 3: Штат и статусы по датам

**Files:** Create `src/engine/staff.ts`; Test `src/engine/staff.test.ts`

**Interfaces:** Consumes: `DateStr`, `GroupCode`. Produces:
- `type Level = 'experienced'|'rookie1'|'rookie2'`
- `Employee { id; name; shortName; group: GroupCode; hireDate: DateStr|null; fireDate: DateStr|null; baseLevel: Level; hiddenFromRating: boolean; transfers: {date: DateStr; group: GroupCode}[] }`
- `Absence { employeeId; kind: 'vacation'|'sick'|'other'; from: DateStr; to: DateStr|null }`
- `groupOn(e, d): GroupCode`, `levelOn(e, d): Level` (rookie1 в первые 7 дней от `hireDate`, rookie2 вторые 7, затем experienced), `isPresent(e, d, absences): boolean` (не уволен, уже принят, не в отсутствии), `countsInRating(e, d, absences): boolean` (= isPresent && !hiddenFromRating)

- [ ] **Step 1:** Тесты: приём 2026-11-02 → `levelOn` 11-08 = rookie1, 11-09 = rookie2, 11-16 = experienced; отпуск 11-10..11-12 с `to:null` для 11-20 → absent; `fireDate` 11-10 → присутствует 11-09, нет 11-10; перевод меняет `groupOn`.
- [ ] **Step 2–5:** FAIL → реализовать → PASS → commit.

### Task 4: Нормы и оценка дня

**Files:** Create `src/engine/evaluate.ts`; Test `src/engine/evaluate.test.ts`

**Interfaces:** Consumes: staff.ts, Config. Produces:
- `FunnelDay { employeeId; date; quality: number; long: number }` (long = разговоры от 20 мин)
- `DayResult { group; date; normQuality; normLong; factQuality; factLong; longMet: boolean; qualityMet: boolean }`
- `evaluateDay(group, date, staff, absences, funnel: FunnelDay[], cfg): DayResult` — норма по присутствующим на `date`, факт — сумма по тем же сотрудникам. Если норма 0 → `longMet`/`qualityMet` = false и награды не начисляются (мой выбор).

- [ ] **Step 1:** Тесты с числами спеки: 2 опытных → normQuality 10, normLong 6; опытный + rookie2 → 7 и 4; сотрудник в отпуске не входит ни в норму, ни в факт; перевод группы учитывается.
- [ ] **Step 2–5:** FAIL → реализовать → PASS → commit.

### Task 5: Симуляция питомца

**Files:** Create `src/engine/pet.ts`; Test `src/engine/pet.test.ts`

**Interfaces:** Consumes: calendar.ts, evaluate.ts. Produces:
- `GroupFacts { group; paymentsByDay: Record<DateStr, number>; results: Record<DateStr, DayResult>; overrides: Override[] }`; `Override { date; kind:'piles'|'medkits'|'toys'; delta: number }`
- `PetState { alive; totalPayments: number; phase: 'egg0'|'egg1'|'egg2'|'pet'; stage: number (0..15); medkits; toys; piles; mood: 'ok'|'bored'|'sad'|'sick'; satiety: number; generation: number }`
- `simulate(facts: GroupFacts, asOf: DateStr, cfg: Config): PetState` — идемпотентна: чистая функция фактов, идёт по рабочим дням от старта; награды за день D применяются на следующий рабочий день после D; оплаты кормят сразу; смерть → яйцо со следующего рабочего дня, `totalPayments` для яйца считается с момента смерти, история не теряется.
- `useMedkit(state)`, `useToy(state)`: возвращают новое состояние (расход запаса, снятие болезни/скуки/грусти); в движке как `Override`-события `use` (добавить в `Override.kind`: `'useMedkit'|'useToy'`).

- [ ] **Step 1 (тесты):** яйцо: 0→egg0, 1→egg1, 3→egg2, 5→phase `pet`; день с `longMet` → medkits+1 и piles−1 (не ниже 0); `!longMet` → piles+1, не выше `maxPiles`; `qualityMet` → toys+1; piles ≥ 1 → mood `sad`; 2 рабочих дня без оплат → `sick`; piles 5 → `sick`; 5 рабочих дней без оплат → `alive:false`, следующий рабочий день → яйцо, `generation` +1; выходные не считаются днями без оплат; `simulate` дважды с теми же фактами даёт равный результат (Review Focus 2); 4 теста на пустые данные (Review Focus 3).
- [ ] **Step 2:** FAIL. **Step 3:** Реализовать. Стадии роста: `stage` = число порогов из `cfg.stageThresholds` (15 заглушек, возрастающие), которые перешёл `totalPayments`. **Step 4:** PASS. **Step 5:** commit.

### Task 6: Рейтинги

**Files:** Create `src/engine/ranking.ts`; Test `src/engine/ranking.test.ts`

**Interfaces:** Produces:
- `PaymentRow { employeeId; date; invoice }`
- `RankRow { employeeId; name; group; place: number; value: number }`
- `groupRanking(group, from, to, …): RankRow[]`, `topOverall(n=10, …)`, `heroesOfDay(date, n=10, …)` — только `countsInRating`; герои = процент выполнения личной нормы (качественные+длинные, из воронки) за `date`, при равенстве — больше оплат; ровные места делят номер.

- [ ] **Step 1:** Тесты: отсутствующий и скрытый не попадают; уволенный до даты не попадает, после — не в будущем рейтинге, но в истории прошлых дней остаётся; ничья делит место; пустые данные → `[]`.
- [ ] **Step 2–5:** FAIL → реализовать → PASS → commit.

### Task 7: Демо-данные и сценарий

**Files:** Create `src/demo/demoFacts.ts`; Test `src/demo/demoFacts.test.ts`

**Interfaces:** Produces: `buildDemo(asOf: DateStr): { staff; absences; funnel; paymentsByGroup; cfg }` — 6 групп, по 3–6 вымышленных сотрудников («Тест А.»), детерминированный набор с группами в разных состояниях (яйцо, малыш, взрослый, скучает, болен, мёртвый→яйцо).

- [ ] **Step 1:** Тест: `simulate` по демо для каждой группы даёт ожидаемые phase/mood (по одному на состояние). **Step 2–5:** FAIL → реализовать → PASS → commit.

### Task 8: Ассеты-заглушки

**Files:** Create `public/assets/**`, `src/art/manifest.ts`; Modify `CREDITS.md`

**Interfaces:** Produces: `ART: { room: string; eggs: Record<GroupCode,string[]> (3 фазы); pets: Record<GroupCode,string[]> (стадии → картинки/масштаб); pile: string; flies: string; medkit: string; toy: string; nest: string }`; если для стадии нет картинки — один спрайт с масштабом от `stage`.

- [ ] **Step 1:** Через скилл `game-assets` найти бесплатные CC0 ассеты с животными (Kenney «Animal Pack»/аналоги: львёнок, утёнок, цыплёнок, ягнёнок, сова, бегемот; фоллбек — ближайшие животные) локальными скриптами/`curl`.
- [ ] **Step 2:** Яйца — один спрайт яйца, перекрашиваемый CSS-фильтром/SVG-цветом группы + крапинки и два слоя трещин (SVG, свои).
- [ ] **Step 3:** Проверить размеры скриптом, один раз посмотреть превью; записать каждый файл в `CREDITS.md` (источник, лицензия, автор). **Step 4:** commit.

### Task 9: Экран с питомцами (рендер)

**Files:** Create `src/game/render.ts`, `src/game/PetView.ts`, `src/game/PowerSaver.ts`, `src/game/room.css`; Modify `src/main.ts`, `index.html`

**Interfaces:** Consumes: `simulate`, `ART`, `buildDemo`. Produces:
- `mount(root: HTMLElement, getStates: () => Record<GroupCode, PetState>): { update(): void }`
- `PowerSaver`: режимы active/ambient/idle по видимости вкладки и простою; `onTick(cb)`.

Поведение: шесть гнёзд в комнате (референс `tamagochi ref.jpg`), питомец бродит около гнезда; для `egg0..2` — яйцо с трещинами; `piles` — кучки с мухами (анимация только при `piles>0`); `sad/sick/bored` — позы и значки; два ящика «Аптечки / Игрушки» со счётчиками на группу; подпись кода группы; сытость — полоска. Рендер — DOM/SVG + CSS-анимации; мягкая приглушённая палитра, без монет.

- [ ] **Step 1:** Скрипт `tools/check-render.mjs` (Playwright, скилл `webapp-testing`): грузит `?demo=1`, проверяет в DOM 6 `[data-group]`, у демо-групп нужные `data-phase`/`data-mood`, консоль без ошибок.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Реализовать рендер; режим `?demo=1` берёт `buildDemo`. **Step 4:** check → PASS. **Step 5:** один скриншот превью пользователю; commit.

**Веха 1:** страница с питомцами на демо-данных открывается локально и в `npm run build`.

---

## Этап 2 — Данные, импорт, бэкенд

### Task 10: Парсер файла оплат

**Files:** Create `src/import/payments.ts`; Test `src/import/payments.test.ts`; фикстура — мини-xlsx из 6 строк (вымышленные ФИО), собирается в тесте через SheetJS

**Interfaces:** Produces: `parsePaymentsXlsx(buf: ArrayBuffer): { rows: PaymentRow-like {date; group: GroupCode; author: string; invoice: string; amount: number}[]; skipped: {reason: 'duplicate'|'cheap'|'unknownGroup'|'noInvoice'; row: number}[] }` — шапка ищется по заголовку «№ счета» (не по номеру строки); код группы вытягивается regexp `СР\d+` из «Группа»; дубль «№ счета» отбрасывается; `amount < 100` отбрасывается.

- [ ] **Step 1:** Тесты по Review Focus 4 (дубль, 30 ₽, группа `Москва_СР4` вне списка, пустой файл). **Step 2–5:** FAIL → реализовать → PASS → commit.
- [ ] **Step 6:** Проверка на реальном образце (`Детальные данные по оплаченным счетам_n (43).xlsx`, не коммитить): ожидается 68 уникальных счетов минус дешёвые (5 строк < 100) — вывести счётчики скриптом.

### Task 11: Парсер воронки

**Files:** Create `src/import/funnel.ts`; Test `src/import/funnel.test.ts`

**Interfaces:** Produces: `parseFunnelXlsx(buf, targetDate: DateStr): { rows: FunnelDay[] (по ФИО→employeeId через staff); unknownEmployees: string[] }`.

- [ ] **Step 1 (разведка):** скриптом (pandas/openpyxl, без открытия картинок) определить в `Копия АП_НП_СР_Воронка_Дни_Шунькина (1).xlsx` лист, строку заголовков, колонки «Качественные счета, шт.» и «Разговоры от 20 мин, шт.» (около столбцов 337/637/817), как задаётся дата и сотрудник; результат записать в комментарий в начало `funnel.ts` и в раздел 8 спеки.
- [ ] **Step 2:** Тест на мини-фикстуре той же формы; **Step 3–5:** FAIL → реализовать → PASS → commit.

### Task 12: Бэкенд Apps Script (хранилище + PIN)

**Files:** Create `apps-script/Code.gs`, `apps-script/README.md`, `tools/mock-backend.mjs`, `apps-script/test/backend.test.mjs`

**Interfaces:** Produces — `GET` (публично, кэш 10–15 с в `CacheService`): `{serverNow, config, groups: GroupFacts-входы (paymentsByDay), staffPublic (имя, группа, статусы), funnel, absences, overrides}` без хешей и PIN. `POST` (JSON как `text/plain`; PIN в теле): `login`, `changePin`, `setGroupPins`, `groupLogin`, `setProvisional {group,date,count}`, `importPayments {from,to,rows,dryRun?}` (заменяет всё за период, 1 строка = 1 оплата), `importFunnel {date,rows}`, `setStaff {employees}`, `setAbsence`, `removeAbsence`, `setFire`, `setHidden`, `setOverride`, `setConfig`, `useItem {groupPin, kind:'medkit'|'toy'}`. Ответ `{ok:true,…}|{ok:false,error:'invalid_pin'|'locked'|'bad_request'|'server_error'}`. Структура и PIN-схема — как в `sales vs dragon ulyanovsk/apps-script/README.md` (взять за образец, не копировать название проекта). Тот же `Code.gs` исполняется в тестах на фейковых сервисах Google.

- [ ] **Step 1:** Тесты: неверный PIN ×5 → `locked` на 10 минут; PIN группы не открывает админ-действия и наоборот; `importPayments` за период заменяет предварительные числа этого дня (двухслойность 7б) и идемпотентен при повторе; `setProvisional` после импорта переопределяет день; `setAbsence` с датами в прошлом сохраняется; GET не содержит хешей.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Реализовать `Code.gs` (листы: `Payments`, `Provisional`, `Funnel`, `Staff`, `Absences`, `Overrides`, `Settings`; PIN-хеши — Script Properties). **Step 4:** PASS. **Step 5:** commit.
- [ ] **Step 6:** `npm run mock-backend` поднимает тот же код на `localhost:8787/exec`, админ-PIN `1234` (только для мока).

### Task 13: Клиент данных (api + store)

**Files:** Create `src/data/api.ts`, `src/data/store.ts`; Test `src/data/store.test.ts`

**Interfaces:** Consumes: ответ GET из Task 12. Produces:
- `api.get(): Promise<Snapshot>`, `api.post<T>(action, body): Promise<T>`; `?backend=<url>` переопределяет адрес
- `buildStates(snapshot, asOf): Record<GroupCode, PetState>` — фактические оплаты за день = импортированные (если день импортирован) иначе предварительные; применяет Task 4–5
- `createStore(poll=15000)` с `subscribe`, опрос только при видимой вкладке и без перерисовки при неизменном ответе (сравнение `serverNow`-независимого хеша).

- [ ] **Step 1:** Тесты: день с импортом перекрывает предварительные числа; без импорта берутся предварительные; неизменный снимок не вызывает `subscribe`-колбэк. **Step 2–5:** FAIL → реализовать → PASS → commit.

### Task 14: Экран на живых данных + рейтинги

**Files:** Create `src/game/RankingPanel.ts`; Modify `src/main.ts`, `render.ts`

**Interfaces:** Consumes: store, ranking.ts. Produces: панель «Группа / Топ-10 / Герои вчерашнего дня» с полными ФИО и местами, история по дате (выпадающий выбор дня).

- [ ] **Step 1:** Расширить `tools/check-render.mjs`: мок-бэкенд + демо-снимок; проверка, что в панели есть ФИО и место; отпускник отсутствует в рейтинге. **Step 2–5:** FAIL → реализовать → PASS → commit.

## Этап 3 — Админка и РГ

### Task 15: Админка — вход, оплаты, импорт

**Files:** Create `admin.html`, `src-admin/main.ts`, `src-admin/styles.css`, `src-admin/payments.ts`, `src-admin/importTab.ts`; Modify `vite.config.ts` (мульти-вход)

**Interfaces:** Consumes: `api.post`, парсеры Task 10–11. Produces: вкладки «Оплаты» (предварительное число по группе за сегодня, `setProvisional`), «Импорт» (загрузка оплат за вчера с `dryRun`-превью «что заменится», затем подтверждение; загрузка воронки), «PIN-коды» (генерация, показ один раз, кнопка копирования, поле без `name`).

- [ ] **Step 1:** Playwright-проверка против мок-бэкенда: ввод оплаты → экран видит яйцо с трещиной; импорт образца → число заменено; PIN не появляется в DOM после закрытия показа. **Step 2–5:** FAIL → реализовать → PASS → commit.

### Task 16: Админка — штат, отсутствия, нормы, ручные правки

**Files:** Create `src-admin/staff.ts`, `src-admin/norms.ts`, `src-admin/overrides.ts`

**Interfaces:** Produces: вкладка «Сотрудники» (список ~60 с поиском; приём, перевод, увольнение с датой, отмена; отсутствия с типом и датами; флаг «не учитывать в рейтинге» с причиной; загрузка списка из JSON), «Нормы» (три плашки опытный/новичок1/новичок2, предзаполнены, правка), «События» (пороги: кучки, скука, болезнь, смерть, стадии), «Ручные правки» (выдать/сбросить кучки, аптечки, игрушки).

- [ ] **Step 1:** Тесты движка уже покрывают пересчёт (Task 3–6); добавить Playwright-сценарий: отпуск задним числом меняет норму группы и рейтинг только затронутых дней (Review Focus 5). **Step 2–5:** реализовать → PASS → commit.

### Task 17: Страница РГ

**Files:** Create `rg.html`, `src-rg/main.ts`

**Interfaces:** Consumes: `groupLogin`, `useItem`. Produces: вход по PIN группы, показ стадии питомца, кнопки «Аптечка» / «Игрушка» с анимацией руки на экране (событие `use` читается экраном из снимка).

- [ ] **Step 1:** Тесты бэкенда уже покрывают права; Playwright: РГ СР1 применяет игрушку → запас −1, на экране СР1 анимация; чужую группу выбрать нельзя. **Step 2–5:** FAIL → реализовать → PASS → commit.

## Этап 4 — Выпуск

### Task 18: Деплой и документация

**Files:** Create `.github/workflows/pages.yml` (или `npm run deploy`), `docs/tech.md`; Modify `CLAUDE.md`, `PLAN.md`, `README.md`

- [ ] **Step 1:** Развёртывание Apps Script по `apps-script/README.md` (вручную пользователем: URL в `public/config.json`, `ADMIN_PIN` в Script Properties — не в чате).
- [ ] **Step 2:** `npm run build` + публикация на GitHub Pages; открыть `?demo=1` и боевой режим, консоль без ошибок.
- [ ] **Step 3:** Проверить, что в репозитории и `dist` нет реальных ФИО, PIN, `*.xlsx` (grep по `dist` и `git ls-files`).
- [ ] **Step 4:** Обновить `PLAN.md` (что сделано / дальше / решения); `graphify update .`; commit.

---

## Покрытие спеки (самопроверка)

Разделы 4 (правила) → Tasks 2–5; рейтинги → 6, 14; роли и PIN → 12, 15, 17; импорт оплат/воронки (7б) → 10–12, 15; двухслойные оплаты → 12–13; штат/отсутствия/увольнения (7в) → 3, 16; стиль и слабые устройства → 8–9; приватность → Global Constraints, Task 18 шаг 3; прототип → Этап 1.

Открытое, что потребует данных от заказчика позже: реальные пороги стадий (месячный план и средние оплаты), нормы-плашки при необходимости, список сотрудников, финальная графика питомцев.
