#!/usr/bin/env bash
# Phase 0, step 1 — READ-ONLY checks before anything is changed.
#   bash phase0-check.sh > phase0-check.txt 2>&1
# Changes nothing, starts nothing, sends nothing. Prints no secret values.
# Review before sharing: job names and log lines are business information.
set -u
HB="$(command -v hermes || echo "$HOME/.local/bin/hermes")"
H="${HERMES_HOME:-$HOME/.hermes}"; case "$H" in */profiles/*) H="${H%/profiles/*}";; esac
export HERMES_HOME="$H"   # an agent running this has HERMES_HOME set to its own profile; use the real root
sec() { printf '\n==================== %s ====================\n' "$1"; }
cfg() { "$HB" -p "$1" config get "$2" --json 2>/dev/null; }
PROFILES="default $(ls "$H/profiles" 2>/dev/null | grep -vE '^\.|^default$' | tr '\n' ' ')"
echo "Hermes root: $H   agents found: $PROFILES"

sec "Is anything else polling the Telegram bots? (0 = no)"
if journalctl --user -u hermes-gateway -n 1 --no-pager >/dev/null 2>&1; then
  journalctl --user -u hermes-gateway --since "-7d" --no-pager -o cat 2>/dev/null \
    | grep -ciE "conflict|terminated by other getUpdates" | sed 's/^/getUpdates conflicts in 7 days: /'
else echo "gateway log not readable here: UNKNOWN"; fi
journalctl --user -u hermes-gateway --since "-7d" --no-pager -o cat 2>/dev/null \
  | grep -iE "cross.process" | sed -E 's/[0-9a-f]{8,}/<id>/g' | cut -c1-160 | tail -5

sec "Approval settings per agent (mode must NOT be off)"
for P in $PROFILES; do
  printf '%-8s mode=%s cron_mode=%s unattended_mode=%s\n' "$P" "$(cfg "$P" approvals.mode)" "$(cfg "$P" approvals.cron_mode)" "$(cfg "$P" approvals.unattended_mode)"
done

sec "Connected services (MCP) per agent: trust level"
for P in $PROFILES; do
  echo "[$P]"
  cfg "$P" mcp_servers | python3 -c '
import json,sys
try: d=json.load(sys.stdin) or {}
except Exception: d={}
if not isinstance(d,dict) or not d: print("  (none)")
for n,v in (d.items() if isinstance(d,dict) else []):
    v=v if isinstance(v,dict) else {}
    print("  %s: trust=%s enabled=%s" % (n, v.get("trust","full (default)"), v.get("enabled", True)))'
done

sec "Scheduled jobs that mention hayes or marty"
found=0
for P in $PROFILES; do
  out="$("$HB" -p "$P" cron list 2>&1 | grep -iE -B2 -A2 'hayes|marty')"
  [ -n "$out" ] && { echo "[$P]"; echo "$out"; found=1; }
done
[ "$found" = 0 ] && echo "(none found in 'hermes cron list' output)"
echo "--- every scheduled job on file (name, schedule, state), and where hayes/marty appear"
python3 - "$H" <<'PY'
import glob, json, os, re, sys
root = sys.argv[1]
for path in sorted(glob.glob(root + "/cron/jobs.json") + glob.glob(root + "/profiles/*/cron/jobs.json")):
    who = "default" if path.startswith(root + "/cron") else path.split("/profiles/")[1].split("/")[0]
    try: data = json.load(open(path))
    except Exception as e: print("[%s] unreadable: %s" % (who, e)); continue
    jobs = data.get("jobs", data) if isinstance(data, dict) else data
    if isinstance(jobs, dict): jobs = list(jobs.values())
    jobs = [j for j in (jobs or []) if isinstance(j, dict)]
    print("[%s] %d job(s)" % (who, len(jobs)))
    for j in jobs:
        text = json.dumps(j)
        sched = j.get("schedule"); sched = sched.get("display", sched.get("expr", sched)) if isinstance(sched, dict) else sched
        state = "paused" if j.get("paused") or j.get("enabled") is False else j.get("state", "active")
        hits = sorted(set(m.lower() for m in re.findall(r"hayes|marty", text, re.I)))
        print("  - %s | %s | %s | deliver=%s%s" % (j.get("name") or j.get("id"), sched, state, j.get("deliver"), (" | MENTIONS " + ",".join(hits)) if hits else ""))
        for m in list(re.finditer(r"hayes|marty", text, re.I))[:2]:
            print("      ...%s..." % text[max(0, m.start() - 70):m.end() + 70].replace("\\n", " "))
PY

sec "Jeff's tools (is kanban already on?)"
"$HB" -p jeff tools --summary 2>&1 | head -40

sec "Listeners (127.0.0.1 = Pi only; 0.0.0.0 = whole network)"
ss -tln 2>/dev/null | awk 'NR==1 || /LISTEN/'

sec "Backups"
systemctl --user list-timers --all --no-pager 2>/dev/null | grep -iE 'hermes|backup' || echo "no backup timer"
ls -lt "$HOME"/hermes-backups "$HOME"/hermes-backup-*.zip 2>/dev/null | head -5 || echo "no backups found"
df -h "$HOME" | tail -1 | awk '{print "free disk space for backups: "$4}'

sec "Done. Nothing was changed."
