# Игра на весь ноябрь — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Игра идёт до 30.11 (20 рабочих дней). План оплат группы складывается из личных месячных планов служебки × 105%. Новички считаются по 2+2 недели от даты приёма.

**Architecture:** Календарь и запасные нормы живут в `defaultConfig`: в таблице они не переопределены, поэтому меняются вместе с выпуском сайта. Личный план — новое поле сотрудника `paymentPlan` (лист Staff, `setStaff`, снимок). План сотрудника на день считает одна функция движка `employeePlanCents`. Ею пользуются и `paymentPlanCents` (группа), и «Итоги» админки (сотрудник). Сотые дробные, округление — один раз в итоге.

**Tech Stack:** Vite + TypeScript, Vitest, Google Apps Script (`apps-script/Code.gs`, тесты через `apps-script/test/gas-harness.mjs`), Playwright-проверки `tools/check-*.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-11-month-game-design.md`

## Global Constraints

- Период игры `2026-11-02`…`2026-11-30`. Выходные `04, 07, 08, 14, 15, 21, 22, 28, 29.11`. 20 рабочих дней.
- Пороги стадий не трогать: `[25, 50, 75, 100]`.
- `personalPlanPercent: 105`. Запасные нормы оплат: опытный `0.3`, новичок 1 `0`, новичок 2 `0.1`. Нормы воронки по умолчанию не менять.
- `paymentPlan`: число `0…50`, не больше двух знаков после запятой, или `null`. Такие же границы, как `isNorm_` / `NORM_MAX`.
- Новичок 1 — дни `< hireDate + 14`, новичок 2 — `< hireDate + 28`, дальше опытный. Базовый `experienced` всегда опытный.
- `NON_WORKING_MAX = 29` и на клиенте, и на сервере. `GAME_END = '2026-11-30'`.
- Никаких ФИО и xlsx в репозитории. JSON для владельца лежит вне репозитория.

## Review Focus

- Снимок от старого бэкенда без поля `paymentPlan` (`undefined`) → запасная норма уровня, без `NaN`. Тест в задаче 1.
- `paymentPlan: 0` — это план 0, а не «нет плана». Тест в задаче 1.
- В ячейке `paymentPlan` листа руками написан мусор (`abc`, `-1`) → сервер читает `null`. Тест в задаче 2.
- Отпуск, приём или увольнение посреди месяца → план пропорционален дням присутствия. Добавлен выходной (19 рабочих дней) → за игру всё равно `paymentPlan × 1.05`. Тест в задаче 1.
- Сумма дробных сотых у порога 25% → `gameCents` округлён до целых, `planPercent` не теряет процент на ошибке плавающей точки. Тест в задаче 1.

---

### Task 1: Движок — календарь, уровни 14/28, личный план

**Files:**
- Modify: `src/engine/config.ts` (`Config.personalPlanPercent`, `defaultConfig`: `endDate`, `nonWorking`, `norms.*.payments`, `personalPlanPercent`)
- Modify: `src/engine/staff.ts` (`Employee.paymentPlan?: number | null`, `levelOn` 14/28)
- Modify: `src/engine/evaluate.ts` (`employeePlanCents`, `paymentPlanCents` и `groupPlan` с округлением в конце)
- Modify: `src/data/config.ts` (`NON_WORKING_MAX = 29`)
- Test: `src/engine/staff.test.ts`, `src/engine/evaluate.test.ts`, `src/engine/calendar.test.ts`, `src/data/config.test.ts`

**Interfaces:**
- Produces: `employeePlanCents(e: Employee, date: DateStr, cfg: Config): number` — дробные сотые на рабочий день. С `paymentPlan != null` — `paymentPlan * cfg.personalPlanPercent / gameWorkingDays(cfg)`, иначе `Math.round(cfg.norms[levelOn(e, date)].payments * 100)`. Присутствие не проверяет: это делает вызывающий.
- Produces: `paymentPlanCents(...)` — та же подпись, теперь возвращает дробные сотые. `groupPlan` отдаёт `gameCents` и `dayCents`, округлённые `Math.round`.

- [ ] Тесты `levelOn`: при найме `2026-10-28` → `rookie1` на `2026-11-10`, `rookie2` на `2026-11-11` и `2026-11-24`, `experienced` на `2026-11-25`. Базовый `experienced` с датой приёма — всегда опытный.
- [ ] Тест календаря: `workingDaysBetween(defaultConfig.startDate, defaultConfig.endDate, defaultConfig).length === 20`. `2026-11-30` — рабочий, `2026-11-28` — нет.
- [ ] Тесты `groupPlan`, все через `defaultConfig`:
  - один сотрудник с `paymentPlan: 6`, весь месяц → `gameCents === 630`, `dayCents === 32` (31,5 → 32);
  - `paymentPlan: 0` → `0`;
  - `paymentPlan` нет (`undefined`), опытный → `600`;
  - приём `2026-11-09` и `paymentPlan: 2` → 16 рабочих дней из 20 → `Math.round(2*105*16/20) === 168`;
  - конфиг с лишним выходным (`nonWorking` + `2026-11-30`) и `paymentPlan: 6` → `630`;
  - восемь человек с `paymentPlan: 5` → `gameCents === 4200`, ровно 25% при 10,5 оплаты не бывает, а 11 оплат дают `planPercent` 26 (через `simulate`).
- [ ] Запустить тесты (через `log-reader`) → FAIL.
- [ ] Реализовать. `gameWorkingDays(cfg)` — `workingDaysBetween(cfg.startDate, cfg.endDate, cfg).length` с кэшем `WeakMap<Config, number>`. `nonWorking` по умолчанию дополнить `2026-11-28` и `2026-11-29`.
- [ ] `npm test` → PASS для движка. Упавшие тесты, которые ждут 14 дней, «из 14» или 0.4, поправить на новые значения в этой же задаче.
- [ ] Коммит `feat: игра до 30.11, личный план оплат, новички 2+2 недели (движок)`.

### Task 2: Бэкенд — период и столбец `paymentPlan`

**Files:**
- Modify: `apps-script/Code.gs`:
  - `GAME_END`, `NON_WORKING_MAX`;
  - `SHEETS.Staff` + `'paymentPlan'`;
  - `readStaff_` — `r[10]`: годное число → число, иначе `null`;
  - `writeStaff_` — `''` или `String(v)`;
  - `publicStaff_` + `paymentPlan`;
  - `setStaffAction_` — `paymentPlan`: `null` или `isNorm_`, иначе `fail_()`; новый сотрудник — `null`;
  - `sheetFor_` — у существующего листа пустая ячейка заголовка последнего столбца → дописать заголовок.
- Test: `apps-script/test/backend.test.mjs`

- [ ] Тесты:
  - `setStaff` с `paymentPlan: 6.3` → в `get().staff` `6.3`;
  - `null` снимает план;
  - `51`, `-1`, `1.234` и `'6'` → `bad_request`;
  - лист без заголовка `paymentPlan` после записи получает заголовок;
  - ячейка `abc` → `null`;
  - выходной `2026-11-28` теперь принимается, `2026-12-01` — нет. Граничный тест `NON_WORKING_MAX` (`backend.test.mjs:924`) под 29 дней.
- [ ] FAIL → реализовать → PASS (`npm test`, через `log-reader`).
- [ ] Коммит `feat: бэкенд — игра до 30.11, личный план сотрудника`.

### Task 3: Админка — поле плана, подписи уровней, «Итоги»

**Files:**
- Modify: `src/admin/staffForm.ts`:
  - `StaffForm.paymentPlan: string`, `StaffPatch.paymentPlan?: number | null`;
  - `buildStaffPatch`, `BulkEdit.paymentPlan: string`, `bulkStaffPatches`;
  - `JSON_KEYS` + `paymentPlan`, проверка в `parseStaffJson`.
- Modify: `src/admin/staffTab.ts`:
  - поле «План оплат на месяц» в карточке (`data-field="paymentPlan"`, `type=number`, `step=0.01`, `min=0`, `max=50`);
  - столбец «План/мес» в таблице;
  - заголовок «Уровни, даты приёма и план»;
  - подсказка: «Новичок 1» — первые две недели от даты приёма, «Новичок 2» — третья и четвёртая; план — из служебки, на месяц.
- Modify: `src/admin/results.ts` — план оплат сотрудника за день и накопленный через `employeePlanCents` (день: `Math.round(c) / 100`).
- Modify: `src/admin/calendarForm.ts` — комментарий про три недели.
- Test: `src/admin/staffForm.test.ts`, `src/admin/results.test.ts`

- [ ] Тесты:
  - `buildStaffPatch`: `'6'` → `6`, `''` при прежнем `6` → `null`, `'6,5'` → `6.5`, `'abc'` и `'51'` → ошибка «План оплат: число от 0 до 50»;
  - `bulkStaffPatches` — то же построчно, в ошибке «Строка N: …»;
  - `parseStaffJson` принимает `paymentPlan: 6` и `null`, отклоняет `'6'` и `1.234`;
  - `results`: сотрудник с `paymentPlan: 6` — план дня `0.32`, накопленный за 3 рабочих дня `0.95` (`Math.round(94.5) / 100`).
- [ ] FAIL → реализовать → PASS.
- [ ] Коммит `feat: админка — личный план оплат и новички 2+2 недели`.

### Task 4: Проверки целиком

**Files:**
- Modify: `tools/check-admin.mjs`, `tools/check-render.mjs` — «из 14» → «из 20», `BUILT_IN_OFF`, число дней и клеток сетки выходных (пятая неделя из одного дня). Ожидания стадий и планов демо — по фактическим новым значениям, каждую правку обосновать новыми правилами.
- Modify: `.claude/skills/game-architecture/SKILL.md` — «14 рабочих дней» → 20, личный план.

- [ ] `npm test`, `npm run build`, `npm run check:render`, `npm run check:admin`, `npm run audit:publish` — всё через `log-reader`, всё зелёное.
- [ ] `~/.local/bin/graphify.exe update .`
- [ ] Ревью ветки субагентом `reviewer`: спека плюс дифф. Найденное поправить.
- [ ] Коммит `test: проверки под игру до 30.11`.

### Task 5: Данные владельца и выпуск

- [ ] Собрать JSON из служебки, вне репозитория (рядом со служебкой в «Загрузках»): `[{ name, group, hireDate, paymentPlan }]`. `name` и `group` — как в штате игры (снимок), `hireDate` и `paymentPlan` — из служебки. Для трёх ноябрьских новичков `paymentPlan: 2`, их даты не трогать. Прогнать через `parseStaffJson` (скрипт в scratchpad) и через мок-бэкенд: `setStaff` на копии живого снимка → стадии как в спеке.
- [ ] Свежий GET снимка → пересчитать стадии с новыми правилами без JSON и с JSON. Не откатывается никто, кроме СР2.
- [ ] Владелец: новый `Code.gs` → новая версия развёртывания. После его «да» — слияние `tv-screen` → `master` без force-push.
- [ ] `node tools/check-live.mjs https://konturproject.github.io/sales-pets/ --backend`. ТВ `?asOf=2026-11-23` / `28` / `30` / `2026-12-01`: «день 15 из 20», выходной, «день 20 из 20», «игра окончена».
- [ ] Владелец загружает JSON. Свежий снимок → стадии как в спеке.
- [ ] `docs/deploy.md` (период, порядок выпуска), `PLAN.md`, два документа Claude Docs (сотрудникам: срок игры и смысл стадий; админу: личный план, загрузка JSON, новички 2+2).
