#!/usr/bin/env bash
# Consistent backup of Hermes Control data (works while the server runs: VACUUM INTO
# takes a transactionally consistent snapshot even in WAL mode). Keeps 14 days.
set -euo pipefail
DATA_DIR="${1:-/var/lib/hermes-control}"
DEST="${2:-/var/backups/hermes-control}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"
node --disable-warning=ExperimentalWarning -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1], { readOnly: false });
  db.exec(`VACUUM INTO ${JSON.stringify(process.argv[2])}`);
' "$DATA_DIR/hermes-control.db" "$DEST/hermes-control-$STAMP.db"
tar -C "$DATA_DIR" -czf "$DEST/files-$STAMP.tar.gz" uploads avatars 2>/dev/null || true
find "$DEST" -type f -mtime +14 -delete
echo "backup written to $DEST ($STAMP)"
