#!/usr/bin/env bash
# READ-ONLY: why are the agents slow, and what is safe to tune?
#   bash speed-check.sh > speed-check.txt 2>&1          # changes nothing, costs nothing
#   bash speed-check.sh --ping > speed-check.txt 2>&1   # also times one tiny real reply per agent
#                                                       # (a few cents of AI fees in total)
# Prints no secret values. Review before sharing: log lines are business information.
set -u
HB="$(command -v hermes || echo "$HOME/.local/bin/hermes")"
H="${HERMES_HOME:-$HOME/.hermes}"
PING=0; [ "${1:-}" = "--ping" ] && PING=1
sec() { printf '\n==================== %s ====================\n' "$1"; }
cfg() { "$HB" -p "$1" config get "$2" --json 2>/dev/null; }
PROFILES="$(ls "$H/profiles" 2>/dev/null | grep -vE '^\.|^default$' | tr '\n' ' ')"

sec "The Pi itself (rarely the bottleneck: the AI runs in the cloud)"
uptime; free -h | sed -n 2,3p
command -v vcgencmd >/dev/null && { vcgencmd measure_temp; vcgencmd get_throttled; }
df -h "$H" | tail -1
ping -c 3 -q api.anthropic.com 2>/dev/null | tail -1 || echo "ping to api.anthropic.com: not available"

sec "Per agent: model, and how much text is sent with EVERY message"
printf '%-7s %-22s %-9s %-9s %-9s %-7s %s\n' agent model SOUL.md MEMORY.md USER.md skills "connected services (tools)"
for P in $PROFILES; do
  D="$H/profiles/$P"
  sz() { [ -f "$1" ] && wc -c < "$1" || echo 0; }
  mcp="$(cfg "$P" mcp_servers | python3 -c '
import json,sys
try: d=json.load(sys.stdin) or {}
except Exception: d={}
print(len([1 for v in d.values() if not isinstance(v,dict) or v.get("enabled",True)]) if isinstance(d,dict) else 0)' 2>/dev/null)"
  printf '%-7s %-22s %-9s %-9s %-9s %-7s %s\n' "$P" "$(cfg "$P" model.default | tr -d '"')" \
    "$(sz "$D/SOUL.md")" "$(sz "$D/memories/MEMORY.md")" "$(sz "$D/memories/USER.md")" "$(ls "$D/skills" 2>/dev/null | wc -l)" "${mcp:-?}"
done
echo "(sizes in characters; every connected service adds its tool list to each request)"

sec "Jeff: tools switched on per platform (fewer = faster and cheaper)"
"$HB" -p jeff tools --summary 2>&1 | head -40

sec "Streaming to Telegram (auto/draft = you see the reply as it is written)"
for P in default $PROFILES; do printf '%-8s enabled=%s transport=%s\n' "$P" "$(cfg "$P" gateway.streaming.enabled)" "$(cfg "$P" gateway.streaming.transport)"; done

sec "Scheduled-job model (cron.model) per agent: blank = same as chat"
for P in default $PROFILES; do printf '%-8s cron.model=%s\n' "$P" "$(cfg "$P" cron.model)"; done

sec "Gateway warnings and errors, last 24h, grouped (ids and numbers collapsed)"
journalctl --user -u hermes-gateway --since "-24h" --no-pager -o cat 2>/dev/null \
  | grep -E "WARNING|ERROR|Traceback|timed out|timeout|rate.?limit|overloaded|429|529" \
  | sed -E 's/^[0-9-]+ [0-9:,]+ //; s/[0-9a-f]{8,}/<id>/g; s/[0-9]+/N/g' | cut -c1-170 | sort | uniq -c | sort -rn | head -25
echo "restarts in 7 days: $(journalctl --user -u hermes-gateway --since '-7d' --no-pager -o cat 2>/dev/null | grep -ciE 'starting gateway|gateway started|Started .*hermes')"

sec "Scheduled jobs: health"
"$HB" cron doctor 2>&1 | head -25

sec "Usage, last 7 days (tokens per conversation show context bloat)"
"$HB" insights --days 7 2>&1 | head -45

if [ "$PING" = 1 ]; then
  sec "Timed one-word reply per agent (real AI call)"
  for P in $PROFILES; do
    s=$(date +%s.%N)
    out="$(timeout 120 "$HB" -p "$P" chat -q "Reply with only the word OK." 2>&1 | tail -1 | cut -c1-60)"
    e=$(date +%s.%N)
    printf '%-7s %5.1fs  %s\n' "$P" "$(echo "$e - $s" | bc 2>/dev/null || python3 -c "print($e-$s)")" "$out"
  done
  echo "(includes starting the hermes command, about 1-3 s on a Pi; over ~15 s for one word points at the model, the network, or a very large context)"
fi
sec "Done. Nothing was changed."
