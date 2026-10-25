#!/bin/bash
# Сокращает вывод тестов и сборки: при ошибке показывает только строки с ошибками,
# при успехе только последние 5 строк (итог). Код выхода команды сохраняется.
# Остальные команды проходят без изменений. Список команд правьте под свой проект.
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty')

pattern='^(npm test|npm run test|npm run build|npx vitest run|npx tsc --noEmit|pnpm test|pnpm build|pytest)( [^;&|<>`$#\\[:cntrl:]]*)?$'
if [[ "$cmd" =~ $pattern ]]; then
  filtered="out=\$($cmd 2>&1); st=\$?; if [ \$st -eq 0 ]; then echo \"\$out\" | tail -5; else echo \"\$out\" | grep -A 5 -E '(FAIL|ERROR|Error|error TS|failed)' | head -100; fi; exit \$st"
  echo "$input" | jq --arg f "$filtered" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: (.tool_input + {command: $f})}}'
else
  echo "{}"
fi
