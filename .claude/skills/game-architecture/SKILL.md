---
name: game-architecture
description: Устройство этого проекта игры — структура папок, главный цикл, сцены, ассеты, состояние, соглашения по именам. Используй перед любой работой с кодом игры, вместо того чтобы изучать проект заново.
---

# Архитектура игры «Питомцы отделов продаж»

Держите файл до 100 строк. Обновляйте, когда меняется структура. Подробности: спека и план в `docs/superpowers/`, состояние в `PLAN.md`.

## Стек

- Движка нет: Vite + TypeScript, DOM и SVG/PNG-картинки, без canvas.
- Сборка: `npm run build` (`tsc --noEmit` + `vite build`), три входа: `index.html`, `admin.html`, `rg.html`. `base: './'`, пути относительные (сайт живёт под `/sales-pets/` на GitHub Pages).
- Тесты: Vitest (`npm test`), тесты рядом с кодом (`*.test.ts`). Браузерные проверки Playwright: `npm run check:render`, `check:admin`, `check:dist`.
- Бэкенд: Google Apps Script (`apps-script/Code.gs`) + Google-таблица. Мок для разработки исполняет тот же `Code.gs`: `npm run mock-backend`.
- Алиас `@/` → `src/`.

## Папки

| Путь | Что там |
|---|---|
| `src/engine/` | чистая логика без DOM: календарь игры (`calendar.ts`, Москва, 14 рабочих дней), штат и отсутствия (`staff.ts`), оценка дня (`evaluate.ts`), симуляция питомца (`pet.ts`: `simulate()` → `PetState`), рейтинги (`ranking.ts`), типы и группы (`types.ts`: `GROUPS`, `GroupCode`, `DateStr`), конфиг по умолчанию (`config.ts`) |
| `src/data/` | связь с бэкендом: `api.ts` (GET снимка, POST действий, `resolveBackend`, `resolvePollMs`), `store.ts` (опрос раз в 15 с, `since`/`unchanged`), `facts.ts` (`buildFacts`: снимок → состояния питомцев и рейтинги на дату), `config.ts` (таймлайн норм «с даты») |
| `src/game/` | `tv/` — экран ТВ (макет `rooms-and-walk.html`): `TvScreen.ts` (`mountTv`: сцена 1920×1080, мир, доски, камера), `RoomView.ts` (комната `[data-group]`), `PetActor.ts` (питомец в слое мира: блуждание, `hold`/`release` для зала), `Hall.ts` (прогулка и праздник: выход в зал, встречи, конфетти, возвращение), `layout.ts`/`schedule.ts`/`metrics.ts` (геометрия, цикл камеры `shotAt`, табло и строка дня — чистые, с тестами), `art.ts` (декор, SVG-эмоции); `PetView.ts` (гнездо страницы РГ, `MAX_STAGE = 15`), `RankingPanel.ts` (блоки рейтингов, `pickGroup`), `PowerSaver.ts`, `uses.ts` (рука РГ) |
| `src/admin/` | админка: вкладки `*Tab.ts`, чистая логика форм и планов в `*Form.ts`/`*Plan.ts` (с тестами), `session.ts` (PIN только в памяти), `pins.ts` |
| `src/rg/` | страница руководителя группы: вход по PIN группы, перенос предмета к питомцу (`drag.ts`), расход (`spend.ts`) |
| `src/import/` | разбор xlsx воронки и оплат (`funnel.ts`, `payments.ts`), чанк `xlsx` грузится динамически только в админке |
| `src/demo/` | демо-данные на шесть состояний (`?demo=1`) |
| `src/art/manifest.ts` | все пути картинок (`ART`, `GROUP_KEY`) |
| `public/assets/` | картинки: `eggs/`, `pets/`, комната и предметы (SVG делает `tools/make-art.mjs`) |
| `apps-script/` | бэкенд и его тесты (`apps-script/test/`) |
| `tools/` | проверки и утилиты: `check-*.mjs`, `smoke-live.mjs`, `audit-publish.mjs`, `mock-backend.mjs`, `probe-*.mjs`, `blender/` |

## Главный цикл и экраны

- Точка входа общего экрана: `src/main.ts`. `?demo=1` → демо; иначе, если адрес бэкенда пуст, «Игра ещё не запущена»; иначе живой экран.
- Живой экран: `createStore` опрашивает `/exec` → на каждый новый снимок `buildFacts(snapshot, asOf)` → `tv.update()`; `asOf` — `serverToday(snapshot)`. `PowerSaver.onTick` зовёт `tv.setPower(mode)`: `active` — общий план зала, `ambient` (60 с без ввода) — цикл «комнаты 25 с → герои 12 с → группа 18 с → прогулка 30 с» (прогулка при ≥2 вылупившихся), `idle` — всё стоит, питомцы дома. Рост `totalPayments` группы между `update()` — праздник 20 с на общем плане (`data-party`), первое обновление праздника не даёт.
- Страница РГ использует `PetView` и `room.css`; экран ТВ — свои `tv/*` и `tv.css`. Не смешивать: зона сброса РГ — `.stage` (R34).
- Состояние игры не хранится: питомец каждый раз пересчитывается `simulate()` из фактов (оплаты, воронка, расходы РГ) от начала игры до `asOf`. Истина в таблице Apps Script.
- Админка `src/admin/main.ts`, РГ `src/rg/main.ts`: свои входы, общие `api` и `store`.

## Ассеты

- Питомцы сейчас SVG-болванки видов из спеки (`public/assets/pets/srN.svg`, делает `tools/make-art.mjs`), рендер масштабирует их по стадии (`petScale`). Финальная графика — ChatGPT по промптам из локального `docs/art/pet-prompts.md` (в `.gitignore`, не коммитить: в нём реальная фамилия, репозиторий публичный). Темы комнат — `THEME` в `src/art/manifest.ts`.
- Новая картинка: файл в `public/assets/`, путь в `ART` (`src/art/manifest.ts`), строка в `CREDITS.md`.

## Соглашения

- Группы: `СР1, СР2, СР3, СР5, СР6, СР9` (кириллица в данных), латинский ключ в именах файлов (`sr1`…).
- Даты строкой `YYYY-MM-DD` (`DateStr`), «сегодня» по Москве (`moscowToday`), `?asOf=` для проверки на любую дату.
- `?backend=` и `?pollMs=` работают только в dev или на локальном хосте.
- Что нельзя трогать без обсуждения: PIN никогда не попадает в URL, репозиторий, localStorage, sessionStorage и консоль; у поля PIN нет `name`. Реальных ФИО и xlsx в репозитории нет (`npm run audit:publish`). Правила игры (оценка дня, стадии, болезнь, рейтинги) меняются только по спеке.
