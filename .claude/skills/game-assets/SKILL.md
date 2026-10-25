---
name: game-assets
description: Поиск и загрузка бесплатных 2D/3D-ассетов, звуков и шрифтов для игры (Kenney, LPC, Quaternius, KayKit, Poly Haven, ambientCG, Poly Pizza, Iconify, Meshy/Tripo/Hi3D) с учётом лицензий. Использовать, когда нужен спрайт, модель, текстура, иконка, звук или шрифт.
---

# Ассеты для игры

## Порядок поиска, от дешёвого к дорогому

1. **Уже есть в проекте или в локальной библиотеке.** Сначала `assets/`, потом папка из `ASSET_LIBRARY` (если задана, например `~/game-assets`). Ищи по именам файлов (Glob), не открывая картинки.
2. **Открытый API — один `curl`:**
   - Иконки: `curl -sSo assets/ui/icons/<имя>.svg https://api.iconify.design/<набор>/<иконка>.svg` (набор `game-icons` — CC BY 3.0, нужна атрибуция)
   - Poly Haven (CC0): `curl -s -H "User-Agent: game-kit/1.0" "https://api.polyhaven.com/assets?t=models"` → `https://api.polyhaven.com/files/<id>` → `curl` ссылки нужного разрешения (для веба 1k)
   - ambientCG (CC0): `curl -s "https://ambientcg.com/api/v2/full_json?type=Material&q=<запрос>&limit=5&include=downloadData"` → `foundAssets[].downloadFolders.default.downloadFiletypeCategories.zip.downloads[]` (`attribute` вида `1K-JPG`, `downloadLink`) → `curl -sSL -o assets/_raw/<id>.zip "<downloadLink>"`
   - Poly Pizza (CC0/CC-BY): ключ в `POLY_PIZZA_KEY`, заголовок `X-Auth-Token`
3. **Сайт без API (Kenney, OpenGameArt, Quaternius):** WebFetch страницы → найти прямую ссылку на архив и лицензию → `curl -sSL -o assets/_raw/<имя>.zip <url>` → распаковать в `assets/_raw/<имя>/` → скопировать в проект **только нужные** файлы.
4. **Нужен вход в аккаунт (itch.io, Mixamo, Sketchfab, Meshy, Tripo, Hi3D):** не ходи через браузер. Попроси пользователя скачать файл и положить в `assets/_raw/`, дальше работай с файлом.

Claude in Chrome для загрузки ассетов не используй: каждый скриншот — картинка в контексте.

## Где что брать

| Нужно | Где | Лицензия |
|---|---|---|
| 2D: тайлы, UI, персонажи, иконки, звуки, шрифты в одном стиле | Kenney (kenney.nl) | CC0 |
| 2D-персонаж с анимациями (walk, slash, thrust, spellcast, shoot, hurt) | Universal LPC Spritesheet Generator (GitHub LiberatedPixelCup) | CC0/CC-BY/CC-BY-SA/OGA-BY/GPL — авторов указать обязательно, есть CREDITS.csv |
| Пиксель-арт от независимых авторов | itch.io → game assets → free | у каждого своя |
| 3D low-poly персонажи с анимациями | Quaternius, KayKit | CC0 |
| 3D-модели поиском | Poly Pizza | CC0 / CC-BY |
| Текстуры PBR, HDRI, реалистичные модели | Poly Haven, ambientCG | CC0 |
| Иконки | Iconify, game-icons.net | у наборов разные, game-icons CC BY 3.0 |
| Генерация 3D по картинке | Meshy (100 кр./мес), Tripo (300 кр./мес), Hi3D (100 кр. навсегда) | бесплатный тариф: CC BY 4.0, модели публичные |
| Звуки | Kenney (CC0), Freesound (разные CC), jsfxr/ZzFX в коде | — |
| Шрифты | Google Fonts (OFL), проверять кириллицу | OFL |
| Палитры | Lospec | — |

## Лицензии

- **CC0** — бери. **CC-BY / OGA-BY / CC BY 4.0** — указать автора. **CC-BY-SA / GPL** — указать автора, переработки под той же лицензией.
- **«Только некоммерческое», «нельзя в играх», без лицензии** — не брать, сказать пользователю.
- Каждую загрузку сразу записывай строкой в `CREDITS.md`: файлы | источник | автор | лицензия | ссылка. Без записи ассет не добавлять.
- Не скачивай модели в обход оплаты или условий сервиса (выдёргивание из WebGL-просмотрщика, мультиаккаунты) и не предлагай такие способы.

## Экономия контекста

- Не открывай каждую картинку. Размер, количество кадров, сетку спрайт-листа узнавай скриптом (`file`, `identify`, Python PIL) или из описания набора.
- Если нужно выбрать глазами — собери одну картинку-превью из кандидатов (контакт-лист) и посмотри её один раз.
- Поиск по нескольким сайтам отдавай субагенту: в основной контекст он возвращает только пути к файлам и лицензии.
- 3D-модели после загрузки — через скилл `blender-assets` (`check_asset.py`, `prepare_glb.py`).
