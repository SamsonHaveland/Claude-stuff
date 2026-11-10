#!/usr/bin/env bash
# Phase 0 — nightly backups of every agent (Hermes) and of Hermes Control.
#   bash enable-hermes-backup.sh
#
# Adds (all inside your home folder, no sudo):
#   ~/hermes-backups/                      private folder (only you can read it)
#   ~/.local/bin/hermes-nightly-backup     the backup job
#   ~/.config/systemd/user/hermes-backup.{service,timer}   runs it at 03:30 every night
# Uses Hermes's own `hermes backup` (safe while Hermes runs) and keeps the newest 14.
# The zips contain your .env keys and logins: they stay private on this Pi.
# Runs one backup now to prove it works. Changes nothing in Hermes.
# Undo: systemctl --user disable --now hermes-backup.timer
set -euo pipefail
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }
HB="$(command -v hermes || echo "$HOME/.local/bin/hermes")"
[ -x "$HB" ] || die "hermes not found"
"$HB" backup --help 2>&1 | grep -q -- '--keep' || die "this Hermes has no 'hermes backup --keep'"
DEST="$HOME/hermes-backups"
BIN="$HOME/.local/bin/hermes-nightly-backup"
UNIT="$HOME/.config/systemd/user"
mkdir -p "$DEST/hermes-control" "$(dirname "$BIN")" "$UNIT"
chmod 700 "$DEST"

cat > "$BIN" <<EOF
#!/usr/bin/env bash
# Nightly backup (installed by Hermes Control's enable-hermes-backup.sh)
set -uo pipefail
umask 077
DEST="$DEST"
STAMP="\$(date +%Y%m%d-%H%M%S)"
rc=0
"$HB" backup -o "\$DEST/hermes-backup-\$STAMP.zip" -k 14 || rc=\$?
HC="$HOME/hermes-control/data"; NODE="$HOME/.local/share/hermes-control/node/bin/node"
if [ -f "\$HC/hermes-control.db" ] && [ -x "\$NODE" ]; then
  # Hermes Control's own data: a consistent SQLite copy (safe while it runs) + uploaded files.
  "\$NODE" --disable-warning=ExperimentalWarning -e '
    const { DatabaseSync } = require("node:sqlite"); const q = String.fromCharCode(39);
    new DatabaseSync(process.argv[1]).exec("VACUUM INTO " + q + process.argv[2].split(q).join(q + q) + q);
  ' "\$HC/hermes-control.db" "\$DEST/hermes-control/hermes-control-\$STAMP.db" || rc=1
  tar -C "\$HC" -czf "\$DEST/hermes-control/files-\$STAMP.tar.gz" uploads avatars 2>/dev/null || true
  find "\$DEST/hermes-control" -type f -mtime +14 -delete
fi
chmod -R go-rwx "\$DEST" 2>/dev/null
exit \$rc
EOF
chmod 700 "$BIN"

cat > "$UNIT/hermes-backup.service" <<EOF
[Unit]
Description=Nightly backup of Hermes agents and Hermes Control

[Service]
Type=oneshot
ExecStart=$BIN
Nice=10
IOSchedulingClass=idle
EOF
cat > "$UNIT/hermes-backup.timer" <<'EOF'
[Unit]
Description=Nightly Hermes backup (03:30, before the 04:17 auto-update)

[Timer]
OnCalendar=*-*-* 03:30
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now hermes-backup.timer

echo "Running the first backup now (can take a few minutes)…"
if systemctl --user start hermes-backup.service; then echo "backup job finished OK"; else echo "WARNING: backup job reported a problem — see: journalctl --user -u hermes-backup -n 30"; fi
LATEST="$(ls -t "$DEST"/hermes-backup-*.zip 2>/dev/null | head -1 || true)"
[ -n "$LATEST" ] || die "no backup zip was written; see: journalctl --user -u hermes-backup -n 30"
python3 - "$LATEST" <<'PY'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1]); bad = z.testzip(); names = z.namelist()
print(f"zip check: {'OK' if bad is None else 'CORRUPT at ' + bad} · {len(names)} files · "
      f"agents' state.db files: {sum(n.endswith('state.db') for n in names)}")
PY
ls -l "$LATEST" | awk '{print "file: "$NF"  size: "$5" bytes  permissions: "$1}'
systemctl --user list-timers --no-pager | grep hermes-backup
cat <<EOF

Done. Backups run every night at 03:30 into $DEST (newest 14 kept).
They live on the same USB drive as Hermes: they protect against mistakes and corruption,
not against the drive dying. Copying them off the Pi is a later step.
Restore (only if ever needed): hermes import <zip>
Undo: systemctl --user disable --now hermes-backup.timer
EOF
