#!/usr/bin/env bash
# Hermes Control — install on the Raspberry Pi as a per-user systemd service.
#
# Run as samsonhaveland (NOT root), from the folder holding the release tarball:
#   bash install.sh hermes-control-<version>.tar.gz
#
# What it changes (all inside your home directory, nothing system-wide, no sudo):
#   ~/hermes-control/app/        application code (replaced on upgrade; previous kept as app.prev)
#   ~/hermes-control/config.yaml created once with Hermes integration DISABLED; never overwritten
#   ~/hermes-control/.env        created once, empty, chmod 600; never overwritten
#   ~/hermes-control/data/       database, uploads, avatars (kept across upgrades)
#   ~/.local/share/hermes-control/node/  Node 24 LTS, only if a suitable Node is not already installed
#   ~/.config/systemd/user/hermes-control.service  enabled + started
#
# What it does NOT touch: ~/.hermes, the Hermes gateway, Telegram, any Hermes profile or .env.
set -euo pipefail

TARBALL="${1:?usage: bash install.sh hermes-control-<version>.tar.gz}"
BASE="$HOME/hermes-control"
NODE_VER="v24.22.2"
NODE_SHA_ARM64="eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8"
NODE_DIR="$HOME/.local/share/hermes-control/node"
UNIT_DIR="$HOME/.config/systemd/user"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || [ "${HC_ALLOW_ROOT:-}" = 1 ] || die "run as your normal user, not root/sudo"
[ -f "$TARBALL" ] || die "tarball not found: $TARBALL"

say "Preflight"
ARCH="$(uname -m)"; echo "arch: $ARCH"
[ "$ARCH" = "aarch64" ] || [ "${HC_ALLOW_ARCH:-}" = 1 ] || die "expected aarch64 (Raspberry Pi OS 64-bit)"
command -v systemctl >/dev/null || die "systemd not found"
loginctl show-user "$(id -un)" -p Linger 2>/dev/null | grep -q 'Linger=yes' \
  && echo "linger: yes (service survives logout and starts at boot)" \
  || echo "WARNING: linger is off; the service would stop when you log out. Enable with: sudo loginctl enable-linger $(id -un)"
df -h "$HOME" | tail -1

say "Node.js (need >= 22.5)"
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=5)?0:1)' 2>/dev/null; }
NODE_BIN=""
if command -v node >/dev/null && node_ok "$(command -v node)"; then
  NODE_BIN="$(command -v node)"; echo "using system node $("$NODE_BIN" --version) at $NODE_BIN"
elif [ -x "$NODE_DIR/bin/node" ] && node_ok "$NODE_DIR/bin/node"; then
  NODE_BIN="$NODE_DIR/bin/node"; echo "using previously installed $("$NODE_BIN" --version)"
else
  [ "$ARCH" = "aarch64" ] || die "no suitable node and auto-download only supports aarch64"
  echo "downloading Node $NODE_VER (linux-arm64) from nodejs.org, checksum-pinned"
  TMP="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-arm64.tar.xz" -o "$TMP/node.tar.xz"
  echo "$NODE_SHA_ARM64  $TMP/node.tar.xz" | sha256sum -c - || die "Node checksum mismatch; aborting"
  mkdir -p "$NODE_DIR"
  tar -xJf "$TMP/node.tar.xz" -C "$NODE_DIR" --strip-components=1
  NODE_BIN="$NODE_DIR/bin/node"; echo "installed $("$NODE_BIN" --version) at $NODE_BIN"
fi

say "Application"
mkdir -p "$BASE/data"
STAGE="$BASE/app.new"
[ -e "$STAGE" ] && mv "$STAGE" "$BASE/app.failed.$(date +%s)"
mkdir -p "$STAGE"
tar -xzf "$TARBALL" -C "$STAGE" --strip-components=1
[ -f "$STAGE/server/dist/index.js" ] && [ -f "$STAGE/web/dist/index.html" ] || die "tarball is missing build output"
"$NODE_BIN" --disable-warning=ExperimentalWarning -e 'require("node:sqlite")' || die "this Node has no node:sqlite"

if [ ! -f "$BASE/config.yaml" ]; then
  sed -e "s#^dataDir: .*#dataDir: $BASE/data#" \
      -e "s#^  mode: .*#  mode: disabled         \# switch to 'live' only after the API-server step is approved#" \
      "$STAGE/config.example.yaml" > "$BASE/config.yaml"
  echo "created $BASE/config.yaml (Hermes integration DISABLED)"
else
  echo "kept existing $BASE/config.yaml"
fi
if [ ! -f "$BASE/.env" ]; then
  ( umask 077; cp "$STAGE/.env.example" "$BASE/.env" ); echo "created $BASE/.env (empty keys, mode 600)"
fi
chmod 600 "$BASE/.env"

# Swap code atomically, keeping one previous version for rollback.
systemctl --user stop hermes-control.service 2>/dev/null || true
[ -d "$BASE/app.prev" ] && mv "$BASE/app.prev" "$BASE/app.old.$(date +%s)"
[ -d "$BASE/app" ] && mv "$BASE/app" "$BASE/app.prev"
mv "$STAGE" "$BASE/app"
echo "app installed: $(cat "$BASE/app/VERSION" 2>/dev/null)"

say "Service"
mkdir -p "$UNIT_DIR"
sed -e "s#@NODE@#$NODE_BIN#g" -e "s#@BASE@#$BASE#g" "$BASE/app/deploy/pi/hermes-control.service" > "$UNIT_DIR/hermes-control.service"
systemctl --user daemon-reload
systemctl --user enable --now hermes-control.service
sleep 3
systemctl --user --no-pager --lines=5 status hermes-control.service || true

say "Health check"
PORT="$(grep -E '^\s*port:' "$BASE/config.yaml" | head -1 | awk '{print $2}')"; PORT="${PORT:-8787}"
if curl -fsS -m 5 "http://127.0.0.1:$PORT/api/health"; then echo; echo "OK: Hermes Control is answering on port $PORT"; else
  echo "Not answering yet. Logs: journalctl --user -u hermes-control -n 50 --no-pager"; exit 1; fi

if ! "$NODE_BIN" --disable-warning=ExperimentalWarning -e '
  const {DatabaseSync}=require("node:sqlite");
  const db=new DatabaseSync(process.argv[1]);
  process.exit(db.prepare("SELECT COUNT(*) n FROM users").get().n>0?0:1)' "$BASE/data/hermes-control.db" 2>/dev/null; then
  say "Create your admin login"
  echo "Choose a password (12+ characters). It is hashed; never stored in plain text."
  ( cd "$BASE/app" && HC_CONFIG="$BASE/config.yaml" "$NODE_BIN" --disable-warning=ExperimentalWarning server/dist/cli/create-user.js samson "Samson" admin "*:owner" )
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "Done"
echo "Open from a device on your home network:  http://hermes-pi.local:$PORT   (or http://$IP:$PORT)"
echo "Hermes integration is OFF. Nothing in ~/.hermes was changed."
echo "Rollback: systemctl --user stop hermes-control && mv $BASE/app $BASE/app.bad && mv $BASE/app.prev $BASE/app && systemctl --user start hermes-control"
echo "Uninstall: systemctl --user disable --now hermes-control && rm ~/.config/systemd/user/hermes-control.service  (then delete ~/hermes-control if wanted)"
