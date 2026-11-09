#!/usr/bin/env bash
# RADAR audit — READ-ONLY evidence collection on the Raspberry Pi.
#   bash radar-audit.sh > radar-audit.txt 2>&1
#
# Collects what each Hermes agent is actually configured to do: models, tools, MCP servers and
# their trust level, approval policy, scheduled jobs and their health, memory size, Kanban use,
# Telegram presence, recent gateway warnings, and 30-day cost.
#
# Safe: changes nothing, starts nothing, sends nothing, triggers no job.
# Secrets: never printed. .env files -> variable NAMES only; config via `hermes config get --json`
# (Hermes masks credential-shaped values) and only specific fields are extracted.
# Review before sharing: job names, SOUL.md headings and log lines are business information.
set -u
HB="$(command -v hermes || echo "$HOME/.local/bin/hermes")"
H="${HERMES_HOME:-$HOME/.hermes}"
sec() { printf '\n==================== %s ====================\n' "$1"; }
sub() { printf '\n--- %s ---\n' "$1"; }
cfg() { "$HB" -p "$1" config get "$2" --json 2>/dev/null; }

sec "System"
date; uname -m; uptime; free -h | sed -n 2p; df -h / | tail -1
"$HB" --version 2>&1 | head -2
systemctl --user is-active hermes-gateway hermes-control hermes-autoupdate.timer 2>/dev/null | paste -sd' ' | sed 's/^/gateway | hermes-control | autoupdate.timer: /'
tailscale status 2>/dev/null | head -1 | awk '{print "tailscale: "$2" "$1}'

PROFILES="default $(ls "$H/profiles" 2>/dev/null | grep -vE '^\.|^default$' | tr '\n' ' ')"
for P in $PROFILES; do
  D="$H"; [ "$P" = default ] || D="$H/profiles/$P"
  [ -d "$D" ] || continue
  sec "Agent: $P"
  echo "model: $(cfg "$P" model.default | tr -d '"')  provider: $(cfg "$P" model.provider | tr -d '"')"
  echo "approvals.mode: $(cfg "$P" approvals.mode)  cron_mode: $(cfg "$P" approvals.cron_mode)  unattended_mode: $(cfg "$P" approvals.unattended_mode)"
  echo "memory provider: $(cfg "$P" memory.provider)"
  for f in MEMORY.md USER.md; do [ -f "$D/memories/$f" ] && echo "memories/$f: $(wc -c < "$D/memories/$f") chars"; done
  if [ -f "$D/SOUL.md" ]; then
    echo "SOUL.md: $(wc -l < "$D/SOUL.md") lines; headings:"; grep -E '^#{1,3} ' "$D/SOUL.md" | head -20 | sed 's/^/   /'
    echo "SOUL.md mentions (count): $(for k in gmail email calendar notion drive telegram kanban delegate approv cron schedul monitor proactive opportunit invoice filmlv 'atomic fox'; do printf '%s=%s ' "$k" "$(grep -ci "$k" "$D/SOUL.md")"; done)"
  fi
  [ -f "$D/.env" ] && echo ".env names: $(grep -oE '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=' "$D/.env" | sed -E 's/^[[:space:]]*(export[[:space:]]+)?//; s/=$//' | sort -u | tr '\n' ' ')"
  sub "MCP servers (name: trust / transport)"
  cfg "$P" mcp_servers | python3 -c '
import json,sys
try: d=json.load(sys.stdin) or {}
except Exception: d={}
if not isinstance(d,dict) or not d: print("  (none)")
for n,v in (d.items() if isinstance(d,dict) else []):
    v=v if isinstance(v,dict) else {}
    trust=v.get("trust","full (default)"); kind="url" if v.get("url") else "command"
    print("  %s: trust=%s transport=%s enabled=%s" % (n, trust, kind, v.get("enabled", True)))'
  sub "Enabled tools summary"; "$HB" -p "$P" tools --summary 2>&1 | head -30
  sub "Scheduled jobs"; "$HB" -p "$P" cron list 2>&1 | head -40
  sub "Cron health"; "$HB" -p "$P" cron doctor 2>&1 | head -20
  sub "Skills (count)"; ls "$D/skills" 2>/dev/null | wc -l
done

sec "Gateway"
"$HB" gateway status 2>&1 | grep -vE '^\s*(Nov|Dec|Jan|[A-Z][a-z]{2}) [0-9]' | head -25
sub "Warnings/errors in the last 24h, grouped (numbers and ids collapsed)"
journalctl --user -u hermes-gateway --since "-24h" --no-pager -o cat 2>/dev/null \
  | grep -E "WARNING|ERROR|Traceback" \
  | sed -E 's/^[0-9-]+ [0-9:,]+ //; s/[0-9a-f]{8,}/<id>/g; s/[0-9]+/N/g' | cut -c1-160 | sort | uniq -c | sort -rn | head -20

sec "Kanban"
"$HB" kanban stats --json 2>&1 | head -30
"$HB" kanban boards list --json 2>&1 | head -10

sec "Usage and cost (30 days)"
"$HB" insights --days 30 2>&1 | head -60

sec "Hermes Control"
ls -la "$HOME/hermes-control" 2>/dev/null | head; [ -f "$HOME/.hermes-autoupdate/status.json" ] && cat "$HOME/.hermes-autoupdate/status.json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("autoupdate:", d.get("result"), d.get("finished_at"))'
sec "Done — nothing was changed"
