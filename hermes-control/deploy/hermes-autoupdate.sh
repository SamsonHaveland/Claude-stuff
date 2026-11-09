#!/usr/bin/env bash
# Unattended Hermes updater — wraps Hermes' own documented updater; adds no update logic of its own.
#
# What it does, once per run (schedule it nightly with launchd on macOS or a systemd timer on Linux):
#   1. Takes a lock so two runs can never overlap.
#   2. `hermes update --check --channel stable` — read-only; stops here if nothing is available.
#   3. `hermes update --yes --backup --channel stable` — Hermes' updater, which itself:
#        * takes a full pre-update backup of HERMES_HOME (--backup),
#        * validates startup files and auto-rolls the checkout back if they are broken,
#        * restarts gateways drain-first (waits for in-flight turns/cron, up to
#          agent.restart_after_turn_timeout, default 30 min),
#        * writes a receipt to ~/.hermes/logs/update_receipts/latest.json.
#   4. Records the outcome in a small JSON status file that Hermes Control displays.
#
# It never changes the update channel, config, profiles or credentials, and never sends messages.
# Only the stable channel (published vX.Y.Z releases) is ever installed.
set -uo pipefail

HERMES_BIN="${HERMES_BIN:-$(command -v hermes || echo "$HOME/.local/bin/hermes")}"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
STATE_DIR="${HC_AUTOUPDATE_DIR:-$HOME/.hermes-autoupdate}"
STATUS_FILE="$STATE_DIR/status.json"
LOG_DIR="$STATE_DIR/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)-$$"
LOG="$LOG_DIR/update-$STAMP.log"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

write_status() { # result exit_code before after note
  python3 - "$STATUS_FILE" "$1" "$2" "$3" "$4" "$5" "$STARTED" "$LOG" <<'PY'
import json, sys, datetime, os, re
path, result, code, before, after, note, started, log = sys.argv[1:9]
warnings = []
try:
    warnings = [l.strip() for l in open(log, encoding="utf-8", errors="replace") if l.lstrip().startswith(("⚠", "✗"))][:20]
except OSError:
    pass
data = {"result": result, "exit_code": int(code), "version_before": before, "version_after": after,
        "note": note, "warnings": warnings, "started_at": started,
        "finished_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "log_file": log, "channel": "stable"}
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(data, f, indent=2)
os.replace(tmp, path)
PY
}

version() { "$HERMES_BIN" --version 2>/dev/null | head -1 | tr -d '\r' || echo unknown; }

# Single instance (mkdir is atomic on macOS and Linux; flock is not on macOS by default).
LOCK="$STATE_DIR/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +240 2>/dev/null)" ]; then rmdir "$LOCK" && mkdir "$LOCK"; else
    echo "another run holds $LOCK; exiting" >>"$LOG"; write_status skipped_locked 0 "" "" "Another update run was in progress"; exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

if [ ! -x "$HERMES_BIN" ]; then
  echo "hermes not found at $HERMES_BIN" >>"$LOG"; write_status failed 127 "" "" "hermes binary not found"; exit 1
fi

BEFORE="$(version)"
{
  echo "== $(date) Hermes auto-update (stable channel) =="
  echo "hermes: $HERMES_BIN  HERMES_HOME=$HERMES_HOME  before: $BEFORE"
  echo "== hermes update --plan (read-only) =="
  "$HERMES_BIN" update --plan --channel stable 2>&1
  echo "== hermes update --check =="
} >>"$LOG" 2>&1

CHECK_OUT="$("$HERMES_BIN" update --check --channel stable 2>&1)"; CHECK_RC=$?
echo "$CHECK_OUT" >>"$LOG"
if [ $CHECK_RC -ne 0 ]; then
  write_status failed "$CHECK_RC" "$BEFORE" "$BEFORE" "Update check failed (network or source problem); nothing was changed"; exit 1
fi
# Hermes prints "Selected release available" (stable) or "Update available" (branch) when there is work.
if ! grep -qE "Selected release available|Update available" <<<"$CHECK_OUT"; then
  LINE="$(grep -m1 '✓' <<<"$CHECK_OUT")"; LINE="${LINE#*✓ }"
  write_status up_to_date 0 "$BEFORE" "$BEFORE" "${LINE:-No update available}"; exit 0
fi

echo "== hermes update --yes --backup --channel stable ==" >>"$LOG"
"$HERMES_BIN" update --yes --backup --channel stable >>"$LOG" 2>&1; RC=$?
AFTER="$(version)"
{
  echo "== exit $RC; after: $AFTER =="
  echo "== gateway status =="; "$HERMES_BIN" gateway status 2>&1 | head -40
  RECEIPT="$HERMES_HOME/logs/update_receipts/latest.json"
  [ -f "$RECEIPT" ] && { echo "== receipt =="; cat "$RECEIPT"; }
} >>"$LOG" 2>&1

# Hermes exit codes (docs): 0 success, 1 pull/install/post-install error, 2 working-tree changes blocked the pull.
case $RC in
  0) if grep -q "⚠" "$LOG"; then RESULT=updated_with_warnings; NOTE="Updated; Hermes reported follow-ups (see warnings)"; else RESULT=updated; NOTE="Updated"; fi ;;
  2) RESULT=failed; NOTE="Local changes in the Hermes checkout blocked the update; nothing was installed" ;;
  *) RESULT=failed; NOTE="hermes update exited $RC; Hermes rolls the checkout back if startup files are broken. See log" ;;
esac
write_status "$RESULT" "$RC" "$BEFORE" "$AFTER" "$NOTE"

# Keep 60 days of logs.
find "$LOG_DIR" -name 'update-*.log' -mtime +60 -delete 2>/dev/null
exit 0
