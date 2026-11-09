#!/usr/bin/env bash
# Turn on the nightly Hermes auto-update on the Raspberry Pi (per-user systemd timer,
# matching how hermes-gateway.service runs on this Pi).
#   bash enable-hermes-autoupdate.sh            # install + enable
#   bash enable-hermes-autoupdate.sh --disable  # turn it off again
#
# Each night at ~04:17 (Pi's local time, +0–20 min random delay) it runs
# ~/hermes-control/app/deploy/hermes-autoupdate.sh, which:
#   - checks for a new STABLE Hermes release and stops if there is none,
#   - otherwise runs `hermes update --yes --backup --channel stable`
#     (full backup first, auto-rollback on broken startup files, drain-first gateway restart),
#   - writes the result to ~/.hermes-autoupdate/status.json, shown in Hermes Control > Settings.
# Missed runs (Pi off at 04:17) run at next boot.
set -euo pipefail
UNIT_DIR="$HOME/.config/systemd/user"
SCRIPT="$HOME/hermes-control/app/deploy/hermes-autoupdate.sh"
die() { printf '\nSTOPPED: %s\nNothing was changed.\n' "$*" >&2; exit 1; }

if [ "${1:-}" = "--disable" ]; then
  systemctl --user disable --now hermes-autoupdate.timer 2>/dev/null || true
  echo "Nightly Hermes auto-update is OFF. (Timer files left in $UNIT_DIR; nothing else changed.)"
  exit 0
fi

[ "$(id -u)" -ne 0 ] || [ "${HC_ALLOW_ROOT:-}" = 1 ] || die "run as your normal user, not sudo"
[ -f "$SCRIPT" ] || die "updater script not found at $SCRIPT (install/upgrade Hermes Control first)"
HB="$(command -v hermes || true)"; [ -n "$HB" ] || HB="$HOME/.local/bin/hermes"
[ -x "$HB" ] || die "hermes not found"
"$HB" --version 2>/dev/null | grep -qi "install method: git" || die "this Hermes is not a git install; 'hermes update' can't manage it"
loginctl show-user "$(id -un)" -p Linger 2>/dev/null | grep -q 'Linger=yes' || echo "WARNING: linger is off, so the timer only runs while you're logged in. Fix: sudo loginctl enable-linger $(id -un)"
echo "hermes: $HB"
echo "time zone: $(timedatectl show -p Timezone --value 2>/dev/null || date +%Z)"

mkdir -p "$UNIT_DIR" "$HOME/.hermes-autoupdate"
cat > "$UNIT_DIR/hermes-autoupdate.service" <<EOF
[Unit]
Description=Nightly Hermes update (stable releases only)
After=network-online.target

[Service]
Type=oneshot
Environment=PATH=$(dirname "$HB"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HERMES_BIN=$HB
ExecStart=/bin/bash $SCRIPT
# The gateway waits for running agent work before restarting (up to 30 min by default).
TimeoutStartSec=90min
Nice=10
EOF
cat > "$UNIT_DIR/hermes-autoupdate.timer" <<EOF
[Unit]
Description=Run the Hermes update check nightly

[Timer]
OnCalendar=*-*-* 04:17
RandomizedDelaySec=20min
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now hermes-autoupdate.timer
echo
systemctl --user list-timers hermes-autoupdate.timer --no-pager || true

echo
echo "Checking for a Hermes update now (read-only)..."
CHECK="$("$HB" update --check --channel stable 2>&1 || true)"
echo "$CHECK" | tail -3
if grep -qE "Selected release available|Update available" <<<"$CHECK"; then
  echo
  echo "An update is available. It will install tonight at ~04:17."
  read -rp "Install it right now instead? Agents finish what they're doing first; Telegram blips briefly. [y/N] " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then systemctl --user start hermes-autoupdate.service; fi
else
  # Record a first result so Hermes Control's Settings shows the updater is working.
  systemctl --user start hermes-autoupdate.service
fi
echo
if [ -f "$HOME/.hermes-autoupdate/status.json" ]; then
  python3 -c 'import json,os; d=json.load(open(os.path.expanduser("~/.hermes-autoupdate/status.json"))); print("Last result:", d["result"], "|", d.get("note",""), "|", d.get("version_after",""))'
fi
echo "Done. Turn off any time: bash enable-hermes-autoupdate.sh --disable"
