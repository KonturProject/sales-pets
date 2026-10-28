# Проект: Питомцы отделов продаж

Игра для геймификации отделов продаж (6 групп СР, питомцы растут от оплат). Без игрового движка: Vite + TypeScript + DOM/SVG. Бэкенд: Google Apps Script + Sheets. Спека и план: `docs/superpowers/`.
Устройство проекта описано в скилле `game-architecture`: читай его, а не весь код.

## Как работаем

1. **Думай до кода.** Если задача неоднозначна, назови свои допущения или задай вопрос. Не угадывай.
2. **Минимум кода.** Решай ровно поставленную задачу, без «заделов на будущее» и лишних абстракций.
3. **Точечные правки.** Меняй только то, что нужно для задачи. Мёртвый код, который заметил по пути, упомяни, но не удаляй.
4. **Проверяемая цель.** До начала работы определи, как проверить результат (тест, лог, сценарий в браузере). Задача не готова, пока проверка не прошла.

## Качество

- Новая механика или экран: сначала план в plan mode, потом код.
- Баг: сначала найди корневую причину и воспроизведи её, потом чини. Заплатки без причины не делай.
- Перед словом «готово» запусти тесты или сборку и покажи результат.
- Сборку, тесты и логи прогоняй через субагент `log-reader`, чтобы длинный вывод не попадал в основной контекст.
- Проверку готовой работы (ревью диффа, ветки, финальную проверку этапа) отдавай субагенту `reviewer` (Opus 5.5, xhigh).
- Чтобы найти, где что лежит, сначала спроси граф: `graphify query "..."`, `graphify explain "..."`. Если этого мало, вызови субагент `code-scout`. Не читай десяток файлов подряд.

## Экономия контекста

- Скриншоты делай только когда без них нельзя. Для проверки игры в браузере сначала используй логи консоли и DOM.
- Перед `/clear` или в конце большой задачи обнови `PLAN.md`: что сделано, что дальше, какие решения приняты.
- Новую сессию начинай с чтения `PLAN.md`.

## Команды

- Запуск: `npm run dev`
- Сборка: `npm run build`
- Тесты: `npm test`

# Compact instructions

Сохраняй: текущую задачу, изменённые файлы, решения по игровой механике, нерешённые баги и шаги проверки. Логи, вывод сборки и содержимое прочитанных файлов не сохраняй.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

<!-- asset-kit -->
## Ассеты и Blender

- Нужен спрайт, модель, текстура, иконка, звук, шрифт → скилл `game-assets`. Сначала локальные файлы и API через `curl`, браузер не использовать. Каждую загрузку записывать в `CREDITS.md`.
- Любая работа с 3D, Blender MCP или спрайтами из 3D → скилл `blender-assets`. Проверка, экспорт и рендер спрайтов — скриптами `bash tools/blender/run.sh ...`, а не пошаговыми MCP-вызовами.
- Картинки и скриншоты не открывать без нужды: размеры и состав проверять скриптами, глазами смотреть одно превью.
- 3D-ассет готов, только когда `check_asset.py` на итоговом GLB вернул `"status": "OK"`.
