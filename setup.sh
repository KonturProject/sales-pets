#!/usr/bin/env bash
# Ставит плагины и скиллы для проекта игры. Запускать из корня проекта:
#   bash setup.sh            — основной набор
#   bash setup.sh --with-mem — плюс claude-mem (память между сессиями)
# Плагины ставятся в project scope (.claude/settings.json), скиллы — в .claude/skills.
# без set -u: на macOS bash 3.2 пустые массивы ломают скрипт

WITH_MEM=0
for arg in "$@"; do
  [ "$arg" = "--with-mem" ] && WITH_MEM=1
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "Не найдено: $1. Установите и запустите снова."; exit 1; }; }
need claude
need npx
need jq

ok=(); fail=()
run() {
  local label="$1"; shift
  echo "→ $label"
  if "$@"; then ok+=("$label"); else fail+=("$label"); fi
}

chmod +x .claude/hooks/*.sh 2>/dev/null

echo "== Маркетплейсы =="
run "official marketplace" claude plugin marketplace add anthropics/claude-plugins-official
run "karpathy marketplace" claude plugin marketplace add forrestchang/andrej-karpathy-skills

echo "== Плагины (project scope) =="
for p in \
  superpowers@claude-plugins-official \
  typescript-lsp@claude-plugins-official \
  claude-md-management@claude-plugins-official \
  code-simplifier@claude-plugins-official \
  frontend-design@claude-plugins-official \
  andrej-karpathy-skills@karpathy-skills
do
  run "$p" claude plugin install "$p" --scope project
done

echo "== Скиллы (.claude/skills) =="
run "find-skills"    npx -y skills add vercel-labs/skills --skill find-skills --agent claude-code -y
run "webapp-testing" npx -y skills add anthropics/skills --skill webapp-testing --agent claude-code -y
run "game-feel"      npx -y skills add gamedev-skills/awesome-gamedev-agent-skills --skill game-feel --agent claude-code -y
run "game-engine"    npx -y skills add github/awesome-copilot --skill game-engine --agent claude-code -y

echo "== graphify (граф знаний по коду) =="
# Граф кода строится локально через tree-sitter, без LLM и без расхода лимита.
if ! command -v graphify >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    run "graphify CLI" uv tool install graphifyy
  elif command -v pipx >/dev/null 2>&1; then
    run "graphify CLI" pipx install graphifyy
  else
    echo "Нет uv и pipx: поставьте uv (https://docs.astral.sh/uv/) и запустите setup.sh снова."
    fail+=("graphify CLI")
  fi
  # uv и pipx кладут graphify сюда; добавляем в PATH для этого запуска
  export PATH="$HOME/.local/bin:$PATH"
fi
if command -v graphify >/dev/null 2>&1; then
  run "graphify skill + hooks" graphify install --project
  run "graphify graph (code-only, offline)" env GRAPHIFY_BACKEND=none graphify extract . --code-only
  run "graphify report" env GRAPHIFY_BACKEND=none graphify cluster-only .
  if [ -d .git ]; then
    run "graphify git hooks" graphify hook install
  else
    echo "Нет .git: git-хуки graphify пропущены. После git init выполните: graphify hook install"
  fi
fi

if [ "$WITH_MEM" = 1 ]; then
  echo "== claude-mem =="
  # По умолчанию claude-mem сжимает память через Claude, то есть из вашего лимита.
  # Gemini со своим ключом лимит Claude не трогает. Вернуть Claude: MEM_PROVIDER=claude bash setup.sh --with-mem
  MEM_PROVIDER="${MEM_PROVIDER:-gemini}"
  echo "Провайдер памяти: $MEM_PROVIDER (подробности в README.md)"
  run "claude-mem" npx -y claude-mem install --provider "$MEM_PROVIDER"
  run "claude-mem telemetry off" npx -y claude-mem telemetry disable
fi

echo
echo "Готово: ${#ok[@]}. С ошибкой: ${#fail[@]}."
for f in "${fail[@]}"; do echo "  ✗ $f"; done
echo "Перезапустите Claude Code, затем проверьте: /plugin (вкладка Installed) и /hooks."
