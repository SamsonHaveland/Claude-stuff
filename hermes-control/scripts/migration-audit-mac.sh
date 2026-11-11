#!/usr/bin/env bash
# Hermes migration — READ-ONLY audit of the Mac (source machine).
#
# Safe by design:
#   * changes nothing: no installs, no restarts, no writes outside stdout
#   * never prints secret VALUES. For .env files it prints variable NAMES only, so you can
#     see which integrations exist without exposing keys
#   * `hermes status` is run in its default mode, which the Hermes docs say prints no key values
#     (`--full` is deliberately NOT used)
#
# Review the output before pasting it anywhere: cron job names and profile names are
# business information (not credentials), and you may want to redact some of them.
#
# Run:  bash migration-audit-mac.sh > mac-audit.txt 2>&1
set -u
H="${HERMES_HOME:-$HOME/.hermes}"
HB="$(command -v hermes || echo "$HOME/.local/bin/hermes")"
sec() { printf '\n===== %s =====\n' "$1"; }
run() { printf '$ %s\n' "$*"; "$@" 2>&1 | head -"${LINES_MAX:-60}"; }
names_only() { # print variable NAMES defined in an env file, never values
  [ -f "$1" ] || { echo "    (no .env)"; return; }
  grep -E '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=' "$1" | sed -E 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/' | sort -u | tr '\n' ' '; echo
}

sec "Host"
sw_vers 2>/dev/null; uname -m; date
sec "Hermes binary and version"
echo "hermes: $HB"; run "$HB" --version
sec "Hermes status (default mode: no key values)"
LINES_MAX=80 run "$HB" status
sec "Profiles"
run "$HB" profile list
echo; echo "Directories under $H/profiles: $(find "$H/profiles" -mindepth 1 -maxdepth 1 -type d ! -name '.*' 2>/dev/null | wc -l | tr -d ' ')"
[ -d "$H/profiles/.deleted" ] && echo "Tombstoned (deleted) profiles: $(ls "$H/profiles/.deleted" | tr '\n' ' ')"

sec "Per-profile inventory (presence/sizes only)"
for d in "$H" "$H"/profiles/*/; do
  [ -d "$d" ] || continue
  d="${d%/}"; name="$(basename "$d")"; [ "$d" = "$H" ] && name="default"
  [ "$name" = ".deleted" ] && continue
  printf '\n[%s]\n' "$name"
  for f in config.yaml .env SOUL.md profile.yaml auth.json state.db memories/MEMORY.md memories/USER.md cron/jobs.json; do
    [ -e "$d/$f" ] && printf '  %-20s %s\n' "$f" "$(du -h "$d/$f" 2>/dev/null | cut -f1)"
  done
  for dir in skills sessions hooks memories cron vault mcp-tokens state-snapshots backups; do
    [ -d "$d/$dir" ] && printf '  %-20s %s items, %s\n' "$dir/" "$(find "$d/$dir" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" "$(du -sh "$d/$dir" 2>/dev/null | cut -f1)"
  done
  printf '  .env variable names: '; names_only "$d/.env"
  [ -f "$d/profile.yaml" ] && printf '  display_name: %s\n' "$(grep -m1 '^display_name:' "$d/profile.yaml" | cut -d: -f2- | xargs)"
done

sec "Gateway and Telegram"
run "$HB" gateway list
run "$HB" gateway status
for d in "$H" "$H"/profiles/*/; do
  e="${d%/}/.env"; [ -f "$e" ] || continue
  n="$(basename "${d%/}")"; [ "${d%/}" = "$H" ] && n=default
  tg=$(grep -cE '^[[:space:]]*(export[[:space:]]+)?TELEGRAM_BOT_TOKEN=.+' "$e"); wh=$(grep -cE '^[[:space:]]*(export[[:space:]]+)?TELEGRAM_WEBHOOK_URL=.+' "$e")
  [ "$tg" -gt 0 ] && echo "  $n: Telegram bot token SET; mode: $([ "$wh" -gt 0 ] && echo webhook || echo long-polling)"
done
echo "  multiplex_profiles in config.yaml: $(grep -E 'multiplex_profiles' "$H/config.yaml" 2>/dev/null | xargs || echo 'not set (Hermes default: true)')"

sec "Scheduled jobs (job names may be business-sensitive; review before sharing)"
run "$HB" cron status
LINES_MAX=100 run "$HB" cron list

sec "MCP servers / integrations (names only)"
run "$HB" mcp list
for f in auth.json auth/google_oauth.json honcho.json mem0.json slack_tokens.json; do [ -e "$H/$f" ] && echo "  present: $f"; done
ls "$H" 2>/dev/null | grep -iE 'token|google' | sed 's/^/  present: /'

sec "Kanban"
for f in "$H/kanban.db"; do [ -f "$f" ] && echo "  kanban.db $(du -h "$f" | cut -f1)"; done
[ -d "$H/kanban/boards" ] && echo "  boards: $(ls "$H/kanban/boards" | tr '\n' ' ')"
run "$HB" kanban list --json --sort created 2>/dev/null >/dev/null && echo "  task count: $("$HB" kanban list --json 2>/dev/null | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null)"

sec "Background services / autostart on this Mac"
launchctl list 2>/dev/null | grep -iE 'hermes' || echo "(no launchd jobs matching 'hermes')"
ls ~/Library/LaunchAgents /Library/LaunchAgents /Library/LaunchDaemons 2>/dev/null | grep -i hermes || echo "(no hermes plist files)"
echo "crontab lines mentioning hermes: $(crontab -l 2>/dev/null | grep -ci hermes)"
ps -axo pid,etime,command | grep -iE '[h]ermes' | grep -v migration-audit | cut -c1-150 | head -20

sec "Docker on the Mac (is Hermes containerised here?)"
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then docker ps -a --format '{{.Names}}  {{.Image}}  {{.Status}}' | head -20; else echo "Docker not running or not installed"; fi

sec "Backups that already exist"
ls -lh ~/hermes-backup-*.zip 2>/dev/null | awk '{print $5, $6, $7, $8, $9}' || true
for d in "$H/backups" "$H/state-snapshots"; do [ -d "$d" ] && echo "$d: $(ls "$d" | wc -l | tr -d ' ') entries, newest: $(ls -t "$d" | head -1)"; done
[ -f "$H/logs/update_receipts/latest.json" ] && echo "last update receipt: $(stat -f '%Sm' "$H/logs/update_receipts/latest.json")"

sec "Size to migrate"
du -sh "$H" 2>/dev/null; du -sh "$H/hermes-agent" 2>/dev/null
sec "Done — nothing was modified"
