#!/usr/bin/env bash
# Ставит всё для работы с ассетами и Blender в проекте игры. Запускать из корня проекта:
#   bash setup-assets.sh
# Что делает: находит Blender, ставит и включает аддон, подключает MCP-сервер mcp-for-blender (project scope),
# раскладывает скрипты и скиллы, создаёт папки assets/ и CREDITS.md, дописывает правила в CLAUDE.md.
# Ничего платного не подключает. Повторный запуск безопасен.

ok=(); fail=(); todo=()
run() {
  local label="$1"; shift
  echo "→ $label"
  if "$@"; then ok+=("$label"); else fail+=("$label"); fi
}
need() { command -v "$1" >/dev/null 2>&1 || { echo "Не найдено: $1. $2"; exit 1; }; }
need claude "Установите Claude Code."
need uvx "Установите uv: curl -LsSf https://astral.sh/uv/install.sh | sh (Windows: powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\")"

echo "== Blender =="
find_blender() {
  [ -n "$BLENDER" ] && [ -x "$BLENDER" ] && { echo "$BLENDER"; return; }
  command -v blender 2>/dev/null && return
  for p in /Applications/Blender.app/Contents/MacOS/Blender \
           "/c/Program Files/Blender Foundation"/Blender*/blender.exe \
           "/mnt/c/Program Files/Blender Foundation"/Blender*/blender.exe \
           /snap/bin/blender /opt/blender*/blender "$HOME"/blender*/blender; do
    [ -x "$p" ] && { echo "$p"; return; }
  done
}
BL="$(find_blender | tail -1)"
if [ -n "$BL" ]; then
  VER="$("$BL" --version 2>/dev/null | head -1)"
  echo "Найден: $BL ($VER)"
  MAJOR="$(echo "$VER" | sed -E 's/^Blender ([0-9]+)\.([0-9]+).*/\1/')"
  MINOR="$(echo "$VER" | sed -E 's/^Blender ([0-9]+)\.([0-9]+).*/\2/')"
  if [ "${MAJOR:-0}" -lt 4 ] || { [ "${MAJOR:-0}" -eq 4 ] && [ "${MINOR:-0}" -lt 2 ]; }; then
    echo "Нужен Blender 4.2 или новее (LTS). Скрипты на старых версиях не проверялись."
    fail+=("версия Blender")
  fi
  mkdir -p .claude
  echo "$BL" > .claude/blender-path
  ok+=("путь к Blender → .claude/blender-path")
else
  echo "Blender не найден. Скачайте бесплатно: https://www.blender.org/download/ (LTS-версию),"
  echo "затем запустите setup-assets.sh снова или задайте BLENDER=/путь/к/blender."
  fail+=("Blender не найден")
fi

echo "== Аддон и MCP-сервер mcp-for-blender (бывший blender-mcp) =="
if [ -n "$BL" ]; then
  # Пакет blender-mcp переименован в mcp-for-blender; аддон кладётся как blender_mcp.py
  run "аддон MCP for Blender" uvx mcp-for-blender install-addon
  echo "→ включаю аддон в настройках Blender"
  # Как в официальном mcp-for-blender setup: не включать вторую копию, если аддон уже включён под другим именем
  EXPR="import addon_utils, bpy
on = {a.module for a in bpy.context.preferences.addons}
already = [m.__name__ for m in addon_utils.modules(refresh=True)
           if m.__name__ in on and addon_utils.module_bl_info(m).get('name') in ('MCP for Blender', 'Blender MCP')]
if not already:
    if addon_utils.enable('blender_mcp', default_set=True) is None:
        raise SystemExit(1)
    bpy.ops.wm.save_userpref()"
  if BLENDERMCP_NO_UPDATE_CHECK=1 "$BL" -b --python-exit-code 1 --python-expr "$EXPR" >/dev/null 2>&1; then
    ok+=("аддон включён")
  else
    todo+=("В Blender: Edit → Preferences → Add-ons → включить «Interface: MCP for Blender» (один раз)")
  fi
fi
if claude mcp get blender >/dev/null 2>&1; then
  echo "MCP-сервер blender уже подключён"; ok+=("MCP blender (уже был)")
else
  # Телеметрия выключена. Порт по умолчанию 9876, только localhost
  run "MCP blender (project scope, .mcp.json)" \
    claude mcp add blender --scope project -e DISABLE_TELEMETRY=true -- uvx mcp-for-blender
fi
todo+=("Перед работой: в Blender нажать N → вкладка MCP for Blender → Start MCP Server")

echo "== Скрипты, папки, правила =="
chmod +x tools/blender/run.sh 2>/dev/null
mkdir -p assets/_raw assets/sprites assets/tiles assets/ui assets/models assets/textures assets/audio work
[ -f CREDITS.md ] || cat > CREDITS.md <<'EOF'
# Ассеты и лицензии

| Файлы | Источник | Автор | Лицензия | Ссылка |
|---|---|---|---|---|
EOF
ok+=("папки assets/, work/, CREDITS.md")

if [ -f .gitignore ] || [ -d .git ]; then
  for line in "assets/_raw/" "*.blend1"; do
    grep -qxF "$line" .gitignore 2>/dev/null || echo "$line" >> .gitignore
  done
  ok+=(".gitignore")
fi

if [ -f CLAUDE.assets.md ]; then
  if [ -f CLAUDE.md ] && grep -q "<!-- asset-kit -->" CLAUDE.md; then
    echo "Правила ассетов уже есть в CLAUDE.md"
  else
    { echo; cat CLAUDE.assets.md; } >> CLAUDE.md
    ok+=("правила ассетов → CLAUDE.md")
  fi
fi

if command -v npx >/dev/null 2>&1; then
  ok+=("npx есть: gltf-transform запускается без установки")
else
  todo+=("Поставьте Node.js, чтобы Claude мог сжимать GLB через npx @gltf-transform/cli (необязательно)")
fi

echo
echo "Готово: ${#ok[@]}. С ошибкой: ${#fail[@]}."
for f in "${fail[@]}"; do echo "  ✗ $f"; done
echo
echo "Осталось сделать руками:"
for t in "${todo[@]}"; do echo "  • $t"; done
echo "  • Перезапустить Claude Code и проверить /mcp: сервер blender должен быть connected"
[ -n "$BL" ] && echo "  • Проверка скриптов без MCP: bash tools/blender/run.sh check_asset.py <любая модель .glb>"
