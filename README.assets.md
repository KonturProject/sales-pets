# Asset kit для Claude Code

Дополнение к `game-kit`: бесплатные ассеты, Blender MCP и готовые скрипты, которые превращают 3D-модель в игровой GLB и в спрайт-листы. Всё бесплатно, платные генераторы не подключаются.

## Установка (10 минут)

Нужны: `claude`, `uv` ([установка](https://docs.astral.sh/uv/getting-started/installation/)), бесплатный [Blender](https://www.blender.org/download/) 4.2 LTS или новее. Node.js — по желанию, для сжатия GLB.
На Windows запускайте из Git Bash или WSL.

1. Скопируйте содержимое папки в корень проекта игры (рядом с файлами game-kit).
2. В корне проекта: `bash setup-assets.sh`
3. Если установщик написал, что аддон не включился: в Blender Edit → Preferences → Add-ons → включить **Interface: MCP for Blender** (один раз).
4. Каждый раз перед работой с MCP: в Blender нажать `N` → вкладка **MCP for Blender** → **Start MCP Server**.
5. Перезапустите Claude Code и проверьте `/mcp`: сервер `blender` — connected.
6. Проверка скриптов без MCP: `bash tools/blender/run.sh check_asset.py <любая модель .glb>`.

## Что внутри

| Файл | Зачем |
|---|---|
| `setup-assets.sh` | Находит Blender, ставит и включает аддон, подключает MCP-сервер `mcp-for-blender` (project scope, телеметрия выключена), создаёт `assets/`, `work/`, `CREDITS.md`, дописывает правила в `CLAUDE.md` |
| `CLAUDE.assets.md` | 4 строки правил, которые попадут в `CLAUDE.md` (едут в каждом запросе, поэтому коротко) |
| `.claude/skills/game-assets/` | Где брать бесплатные ассеты, как скачивать без браузера, лицензии, `CREDITS.md` |
| `.claude/skills/blender-assets/` | Как работать с Blender MCP экономно, стандарт готовой модели и спрайтов, чек-лист частых ошибок |
| `tools/blender/run.sh` | Запуск скрипта в Blender без интерфейса; в ответ только короткий JSON |
| `tools/blender/check_asset.py` | Проверка модели: масштаб, точка опоры, трансформации, нормали, полигоны, материалы, текстуры, риг и анимации |
| `tools/blender/prepare_glb.py` | Приводит модель к стандарту и экспортирует GLB: высота, опора в (0,0,0), применённые трансформации, анимации сохраняются |
| `tools/blender/render_sprites.py` | Рендер в спрайт-листы: 1/4/8 направлений × N кадров на анимацию, `sheet.json`, `preview.png` |

## Типовой путь «персонаж → игра»

```bash
# 1. Модель: из библиотеки (Quaternius, KayKit), Meshy/Tripo/Hi3D или своя в work/hero.blend
# 2. Проверка исходника
bash tools/blender/run.sh check_asset.py assets/_raw/hero.fbx --height 1.8
# 3. Привести к стандарту и экспортировать
bash tools/blender/run.sh prepare_glb.py assets/_raw/hero.fbx --out assets/models/hero.glb --height 1.8
# 4. Проверка результата: должно быть "status": "OK"
bash tools/blender/run.sh check_asset.py assets/models/hero.glb --height 1.8
# 5a. 3D-игра: сжать для веба
npx -y @gltf-transform/cli optimize assets/models/hero.glb assets/models/hero.min.glb --compress meshopt --texture-compress webp
# 5b. 2D-игра: спрайт-листы (пиксель-арт: --pixel --size 48)
bash tools/blender/run.sh render_sprites.py assets/models/hero.glb --out assets/sprites/hero --directions 8 --frames 8 --size 128
```

Скорость рендера: `--engine eevee` (по умолчанию, нужна видеокарта), `workbench` (быстро, плоский свет, подходит для пиксель-арта), `cycles --gpu` (красиво, медленно).

## Проверено

Скрипты прогнаны в Blender 5.2 без интерфейса на модели Fox из официальных примеров glTF (риг, 3 анимации) и на тестовой модели с ошибками:
- `check_asset.py` нашёл неверный масштаб, смещённую опору, неприменённые масштаб и поворот, процедурную текстуру;
- `prepare_glb.py` исправил всё, кроме процедурной текстуры (о ней предупреждает: её нужно запечь), размеры в анимациях совпали с исходными до тысячных;
- `render_sprites.py` собрал листы 8 направлений × N кадров на Workbench. Eevee проверен только на запуск: на машине без видеокарты он работает очень медленно.

Установка аддона: `uvx mcp-for-blender install-addon` проверена (кладёт `blender_mcp.py` в папку аддонов). Автоматическое включение аддона и вызовы через MCP на настоящем Blender с интерфейсом не проверялись. Если аддон не включился — включите вручную (шаг 3), если не встал — скачайте `addon.py` из [репозитория](https://github.com/ahujasid/blender-mcp) и установите через Add-ons → Install from Disk.

Пакет `blender-mcp` переименован в `mcp-for-blender`; старое имя пока работает, но установщик использует новое.
