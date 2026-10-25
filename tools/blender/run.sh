#!/usr/bin/env bash
# Запускает скрипт asset-kit в Blender без интерфейса и печатает только итог (JSON) и ошибки.
# Шум Blender (логи импорта, рендера) в контекст Claude не попадает.
#   bash tools/blender/run.sh check_asset.py model.glb --height 1.8
#   bash tools/blender/run.sh prepare_glb.py raw/hero.fbx --out assets/models/hero.glb --height 1.8
#   bash tools/blender/run.sh render_sprites.py assets/models/hero.glb --out assets/sprites/hero
# Путь к Blender: переменная BLENDER или .claude/blender-path (его пишет setup-assets.sh).

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
SCRIPT="$1"; shift
[ -f "$DIR/$SCRIPT" ] || { echo "Нет скрипта: $DIR/$SCRIPT"; exit 2; }

BL="${BLENDER:-}"
[ -z "$BL" ] && [ -f "$ROOT/.claude/blender-path" ] && BL="$(cat "$ROOT/.claude/blender-path")"
[ -z "$BL" ] && BL="$(command -v blender 2>/dev/null)"
[ -z "$BL" ] && { echo "Blender не найден. Запустите setup-assets.sh или задайте BLENDER=/путь/к/blender"; exit 2; }

LOG="$(mktemp)"
"$BL" -b --factory-startup --python-exit-code 1 -P "$DIR/$SCRIPT" -- "$@" >"$LOG" 2>&1
CODE=$?
if grep -q "=== RESULT ===" "$LOG"; then
  sed -n '/=== RESULT ===/,$p' "$LOG" | grep -v "^Blender quit\|^$"
fi
if [ $CODE -ne 0 ] || grep -q "Traceback" "$LOG"; then
  echo "--- ошибка (полный лог: $LOG) ---"
  if grep -q "Traceback" "$LOG"; then grep -A12 "Traceback" "$LOG" | tail -20; else tail -8 "$LOG"; fi
  exit 1
fi
if ! grep -q "=== RESULT ===" "$LOG"; then
  echo "--- скрипт не вернул результат (полный лог: $LOG) ---"; tail -8 "$LOG"; exit 1
fi
rm -f "$LOG"
exit 0
