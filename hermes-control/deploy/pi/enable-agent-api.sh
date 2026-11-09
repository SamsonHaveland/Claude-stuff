#!/usr/bin/env bash
# Connect ONE Hermes profile to Hermes Control via Hermes' documented API server.
#   bash enable-agent-api.sh jeff
#
# Hermes changes (this is the step that needs your approval):
#   ~/.hermes/.env                  first run only: API_SERVER_ENABLED=true + API_SERVER_KEY
#                                   (opens ONE listener on 127.0.0.1:8642, this Pi only)
#   ~/.hermes/profiles/<p>/.env     API_SERVER_KEY for that profile (NO enable flag: under the
#                                   multiplexed gateway that would be wrong per Hermes docs)
#   hermes gateway restart          drain-first; Telegram reconnects in seconds
# Hermes Control changes:
#   ~/hermes-control/.env           HC_HERMES_KEY_<P>=same key (mode 600)
#   ~/hermes-control/config.yaml    hermes.mode: live ; service restarted
#
# Safety: every edited file is backed up first (*.bak-hc-<time>), keys are generated locally
# and never printed, existing API_SERVER_* settings are never overwritten (the script stops).
set -euo pipefail
P="${1:?usage: bash enable-agent-api.sh <profile-id>   e.g. jeff}"
[[ "$P" =~ ^[a-z0-9][a-z0-9_-]{0,63}$ ]] || { echo "bad profile id"; exit 1; }
H="$HOME/.hermes"; DEF="$H/.env"; PE="$H/profiles/$P/.env"
HCD="$HOME/hermes-control"; HCE="$HCD/.env"; HCC="$HCD/config.yaml"
PORT=8642; STAMP="$(date +%Y%m%d-%H%M%S)"
VAR="HC_HERMES_KEY_$(echo "$P" | tr 'a-z-' 'A-Z_')"
say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nSTOPPED: %s\nNothing after this point was changed.\n' "$*" >&2; exit 1; }
has() { [ -f "$1" ] && grep -qE "^[[:space:]]*(export[[:space:]]+)?$2=" "$1"; }
newkey() { python3 -c 'import secrets;print(secrets.token_urlsafe(32))'; }
curl_auth() { # $1 key, $2 url -> prints HTTP code; key passed via stdin config, not argv
  printf 'header = "Authorization: Bearer %s"\nurl = "%s"\n' "$1" "$2" | curl -s -m 10 -o /dev/null -w '%{http_code}' -K -; }

say "Preflight (read-only)"
[ "$(id -u)" -ne 0 ] || [ "${HC_ALLOW_ROOT:-}" = 1 ] || die "run as your normal user"
[ -d "$H/profiles/$P" ] || die "profile '$P' not found in $H/profiles"
[ -f "$HCC" ] && [ -f "$HCE" ] || die "Hermes Control is not installed (run install.sh first)"
command -v hermes >/dev/null || die "hermes not on PATH"
has "$PE" API_SERVER_ENABLED && die "$PE contains API_SERVER_ENABLED; under the multiplexed gateway a secondary profile must not set it. Remove it manually first."
has "$PE" API_SERVER_KEY && die "$PE already has API_SERVER_KEY; not overwriting. Copy it into $HCE as $VAR yourself, or remove it and re-run."
FIRST=0
if has "$DEF" API_SERVER_ENABLED || has "$DEF" API_SERVER_KEY; then
  echo "default profile already has API server settings: leaving them unchanged"
else
  FIRST=1
  if ss -tln 2>/dev/null | grep -qE "[:.]$PORT\b"; then die "port $PORT is already in use by something else"; fi
fi
echo "profile: $P | first-time API server setup: $([ $FIRST = 1 ] && echo yes || echo no)"

say "Backups"
for f in "$DEF" "$PE" "$HCE" "$HCC"; do
  if [ -f "$f" ]; then cp -p "$f" "$f.bak-hc-$STAMP"; echo "backed up $f"; fi
done

say "Writing keys (values are not shown)"
umask 077
if [ $FIRST = 1 ]; then
  [ -f "$DEF" ] || : > "$DEF"
  printf '\n# Added %s by Hermes Control setup (API server, loopback only)\nAPI_SERVER_ENABLED=true\nAPI_SERVER_KEY=%s\n' "$STAMP" "$(newkey)" >> "$DEF"
  echo "updated $DEF"
fi
PK="$(newkey)"
[ -f "$PE" ] || : > "$PE"
printf '\n# Added %s by Hermes Control setup (authenticates /p/%s/ only; no second listener)\nAPI_SERVER_KEY=%s\n' "$STAMP" "$P" "$PK" >> "$PE"
chmod 600 "$PE" "$DEF"
echo "updated $PE"
if grep -qE "^$VAR=" "$HCE"; then sed -i "s|^$VAR=.*|$VAR=$PK|" "$HCE"; else printf '%s=%s\n' "$VAR" "$PK" >> "$HCE"; fi
chmod 600 "$HCE"; echo "updated $HCE ($VAR)"

say "Restarting the Hermes gateway (drain-first; it may ask y/N if agents are mid-task)"
hermes gateway restart
for i in $(seq 1 30); do curl -fsS -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 2; done

say "Verifying"
H1="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health")"
H2="$(curl_auth "$PK" "http://127.0.0.1:$PORT/p/$P/v1/capabilities")"
H3="$(curl_auth "not-the-key" "http://127.0.0.1:$PORT/p/$P/v1/capabilities")"
echo "health: $H1 (want 200) | $P with key: $H2 (want 200) | $P with wrong key: $H3 (want 401)"
LISTEN="$( (ss -tln 2>/dev/null || true) | grep -E "[:.]$PORT\b" | awk '{print $4}' | tr '\n' ' ' || true)"
echo "listening on: $LISTEN (want 127.0.0.1:$PORT only)"
if [ "$H1" != 200 ] || [ "$H2" != 200 ]; then
  echo; echo "Verification FAILED. Rollback:"
  echo "  for f in $DEF $PE $HCE $HCC; do [ -f \$f.bak-hc-$STAMP ] && cp -p \$f.bak-hc-$STAMP \$f; done; hermes gateway restart"
  exit 1
fi

say "Switching Hermes Control to live"
sed -i 's/^  mode: disabled.*/  mode: live/' "$HCC"
systemctl --user restart hermes-control
sleep 3; curl -fsS -m 5 http://127.0.0.1:8787/api/health && echo
echo
echo "Done. In Hermes Control, open the DM with $P and send a message."
echo "Also send $P a Telegram message to confirm Telegram still works."
echo "Rollback (restores all four files):"
echo "  for f in $DEF $PE $HCE $HCC; do [ -f \$f.bak-hc-$STAMP ] && cp -p \$f.bak-hc-$STAMP \$f; done; hermes gateway restart; systemctl --user restart hermes-control"
