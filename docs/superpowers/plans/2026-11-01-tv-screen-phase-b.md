# Экран ТВ, фаза Б: прогулка и праздник — план

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** питомцы выходят на прогулку в общий зал (кадр цикла на стене), новая оплата даёт праздник с конфетти.

**Architecture:** расписание и тексты — чистые функции (`schedule.ts`, `metrics.ts`) с тестами Vitest; движение — `PetActor` (позиция x/y/масштаб, прыжок дугой); хореография зала — `src/game/tv/Hall.ts`; `TvScreen` включает прогулку по кадру `walk` и праздник по приросту оплат. Браузерная проверка — `tools/check-render.mjs` (часы Playwright для цикла и суток).

**Tech Stack:** TypeScript, DOM, Web Animations, Vitest, playwright-core.

**Spec:** `docs/superpowers/specs/2026-11-01-tv-walk-party-design.md`

## Global Constraints

- Цикл стены: `rooms 25 000` → `heroes 12 000` → `group 18 000` → `walk 30 000` мс.
- Гуляют живые с `phase === 'pet'`; меньше 2 — кадр `walk` показывается как `rooms`.
- В зале масштаб питомца `1.55`; мест шесть: `[1400,1170] [1000,1210] [1800,1210] [1180,1430] [1620,1430] [1400,1500]`.
- Домой за `4 500` мс до конца кадра; праздник `20 000` мс.
- Плашка: «Прогулка · все гуляют в общем зале»; «СР3: +1 оплата! Все на праздник»; несколько групп «Новые оплаты: СР1 +3 · СР2 +1».
- `PetView`, `room.css`, РГ, `Code.gs` не трогать.

## Review Focus

1. Прогулка прервана: смена снимка (вылупление, гибель) посреди выхода в зал — питомец не застревает в зале.
2. Скрытая вкладка (`idle`) во время прогулки и праздника — все дома, после возврата цикл идёт.
3. Две оплаты подряд во время праздника — второй праздник не ломает первый (перезапуск, без дублей конфетти навсегда).
4. Ноль, один, шесть гуляющих; герой праздника — яйцо или надгробие.
5. Сутки на стене — число узлов DOM не растёт.

---

### Task 1: расписание и тексты праздника

**Files:** Modify `src/game/tv/schedule.ts`, `src/game/tv/metrics.ts`, `src/game/tv/layout.ts` (камера `walk` = `overview`); Test `schedule.test.ts`, `metrics.test.ts`.

**Produces:** `Shot` += `'walk'`; `WALK_MS`; `paymentGains(prev: Record<GroupCode, number> | null, next: Record<GroupCode, number>): { group: GroupCode; gain: number }[]` (по убыванию прироста, только `gain > 0`, `prev === null` → `[]`); `partyBanner(gains): string`.

- [ ] Тесты: `shotAt(55_000)` → `walk`; `shotAt(85_000)` → `rooms`, slide 3; `paymentGains(null, …)` → `[]`; уменьшение не даёт праздника; две группы по убыванию; `partyBanner` для 1/2/5 оплат («оплата/оплаты/оплат») и для нескольких групп. RED → код → GREEN.
- [ ] Commit.

### Task 2: движение по залу и хореография

**Files:** Modify `src/game/tv/PetActor.ts`, `src/game/tv/art.ts` (эмоции `star`, `hi`); Create `src/game/tv/Hall.ts`.

**Produces:** `PetActor`: `walker: boolean`, `y`, `scale`, `moveTo({x,y,s}, ms, arc?)`, `toHall(spot, delay)`, `toRoom()`, `snapHome()`, `hold()` / `release()` (выключить и вернуть блуждание по комнате). `Hall`: `walk(pets, ms)`, `party(star, pets, ms)`, `cancel()`; конфетти и мяч зала удаляются по `finish` и при `cancel`.

- [ ] Сценарии гоняются в браузере (Task 3): у Vitest нет DOM.
- [ ] Commit.

### Task 3: экран и проверка

**Files:** Modify `src/game/tv/TvScreen.ts`, `src/game/tv/tv.css`, `tools/check-render.mjs`.

- [ ] Проверки (сначала RED на старом коде): демо + часы Playwright — через 60 с бездействия и 55 с цикла `.tv[data-shot="walk"]`, гуляющие в зале (y > 980), плашка `.banner.on`; через 30 с все в комнатах; живой мок — `setProvisional` у СР3 +1 → `.tv[data-party="СР3"]`, текст плашки, конфетти; `visibilitychange` → `idle` → питомцы дома, конфетти нет; 2 часа часов Playwright — число узлов `.tv-world` не выросло.
- [ ] Код до GREEN; полный набор: vitest, tsc, build, check:render, check:admin, check:dist.
- [ ] PLAN.md, скилл архитектуры, `graphify update .`, commit, слияние в master, push, проверка выкладки.
