#!/usr/bin/env bash
# Hermes Control — READ-ONLY audit of a local Hermes installation.
#
# What it does: runs read-only Hermes CLI commands and checks for the PRESENCE of files
# and setting NAMES. What it never does: print secret values, modify files, start/stop
# gateways, send messages, or call Telegram.
#
# .env files are only scanned for whether a variable NAME is set (count of matching
# lines); values are never printed. Review this script before running it.
#
# Usage:  bash scripts/audit-hermes.sh > hermes-audit-report.txt
set -u
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
API_PORT="${API_PORT:-8642}"

section() { printf '\n=== %s ===\n' "$1"; }
has_var() { # has_var FILE NAME -> yes/no without printing the value
  [ -f "$1" ] && grep -Eq "^[[:space:]]*(export[[:space:]]+)?$2=.+" "$1" && echo yes || echo no
}

section "Host"
uname -srm
sw_vers 2>/dev/null | tr '\n' ' '; echo
command -v python3 >/dev/null && python3 --version
command -v node >/dev/null && echo "node $(node --version)" || echo "node: not installed (Hermes Control needs Node >= 22.5)"

section "Hermes CLI"
if command -v hermes >/dev/null; then
  echo "hermes binary: $(command -v hermes)"
  hermes --version 2>&1 | head -5
else
  echo "hermes not on PATH"
fi
echo "HERMES_HOME=$HERMES_HOME"
[ -d "$HERMES_HOME/hermes-agent" ] && (cd "$HERMES_HOME/hermes-agent" && echo "source checkout: $(git rev-parse --short HEAD 2>/dev/null) $(git describe --tags 2>/dev/null)")

section "Profiles (names and marker files only)"
hermes profile list 2>&1 | head -40
for d in "$HERMES_HOME" "$HERMES_HOME"/profiles/*/; do
  [ -d "$d" ] || continue
  name=$(basename "$d"); [ "$d" = "$HERMES_HOME" ] && name=default
  [ -e "$HERMES_HOME/profiles/.deleted/$name" ] && { echo "$name: TOMBSTONED (skipped)"; continue; }
  markers=""
  for m in config.yaml .env SOUL.md profile.yaml auth.json state.db; do [ -e "$d/$m" ] && markers="$markers $m"; done
  env="$d/.env"
  printf '%-12s markers:%s\n' "$name" "$markers"
  printf '             API_SERVER_ENABLED set: %s | API_SERVER_KEY set: %s | API_SERVER_PORT set: %s | TELEGRAM_BOT_TOKEN set: %s\n' \
    "$(has_var "$env" API_SERVER_ENABLED)" "$(has_var "$env" API_SERVER_KEY)" "$(has_var "$env" API_SERVER_PORT)" "$(has_var "$env" TELEGRAM_BOT_TOKEN)"
  [ -f "$d/hooks" ] || [ -d "$d/hooks" ] && echo "             hooks/: $(ls "$d/hooks" 2>/dev/null | tr '\n' ' ')"
done

section "Config keys of interest (key names only, from default config.yaml)"
CFG="$HERMES_HOME/config.yaml"
if [ -f "$CFG" ]; then
  for k in multiplex_profiles api_server dispatch_in_gateway "approvals:" "mode:" "webapp:" "kanban:"; do
    printf '%-22s %s line(s)\n' "$k" "$(grep -c "$k" "$CFG")"
  done
else
  echo "no $CFG"
fi

section "Gateway"
hermes gateway list 2>&1 | head -30
hermes gateway status 2>&1 | head -30
launchctl list 2>/dev/null | grep -i hermes || echo "(no launchd jobs matching 'hermes')"
ps -axo pid,command | grep -i "[h]ermes" | grep -iv audit-hermes | cut -c1-160 | head -20

section "API server reachability (no credentials sent)"
for path in /health /v1/health; do
  printf 'GET 127.0.0.1:%s%s -> ' "$API_PORT" "$path"
  curl -s -m 3 -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$API_PORT$path" || echo "no answer"
done
printf 'GET /v1/capabilities without key (expect 401 if the API server is on) -> '
curl -s -m 3 -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$API_PORT/v1/capabilities" || echo "no answer"

section "Kanban (read-only)"
if command -v hermes >/dev/null; then
  hermes kanban boards list --json 2>&1 | head -20
  echo "tasks on current board: $(hermes kanban list --json 2>/dev/null | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 'n/a')"
  hermes kanban assignees --json 2>&1 | head -20
fi

section "Done"
echo "No files were modified. Share this report (it contains no secret values)."
