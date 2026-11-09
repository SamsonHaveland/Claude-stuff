#!/usr/bin/env bash
# Lock Hermes Control to its private Tailscale HTTPS address.
#   bash secure-with-tailscale.sh
#
# Run only AFTER `sudo tailscale serve --bg 8787` works and you can open the https address.
# Changes ~/hermes-control/config.yaml (backed up first):
#   server.host: 127.0.0.1          -> no longer reachable over plain http on your home network
#   server.secureCookies: true      -> login cookie only travels over https
#   server.allowedOrigins: [<url>]  -> changes are accepted only from the Tailscale address
# Nothing in Hermes is touched.
set -euo pipefail
CFG="$HOME/hermes-control/config.yaml"
STAMP="$(date +%Y%m%d-%H%M%S)"
die() { printf '\nSTOPPED: %s\nNothing was changed.\n' "$*" >&2; exit 1; }

[ -f "$CFG" ] || die "Hermes Control is not installed ($CFG missing)"
command -v tailscale >/dev/null || die "tailscale is not installed"
tailscale status >/dev/null 2>&1 || die "tailscale is not connected; run: sudo tailscale up"
NAME="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
[ -n "$NAME" ] || die "could not read this Pi's Tailscale name"
URL="https://$NAME"
echo "Tailscale address: $URL"
tailscale serve status 2>/dev/null | grep -q "8787" || die "tailscale serve is not pointing at Hermes Control; run: sudo tailscale serve --bg 8787"
code="$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$URL/api/health" || true)"
[ "$code" = 200 ] || die "$URL/api/health answered '$code' (want 200). Check MagicDNS and HTTPS certificates are on in the Tailscale admin console."

cp -p "$CFG" "$CFG.bak-ts-$STAMP"
echo "backed up config to $CFG.bak-ts-$STAMP"
python3 - "$CFG" "$URL" <<'PY'
import re, sys
path, url = sys.argv[1], sys.argv[2]
s = open(path).read()
rules = [
    (r'(?m)^(\s+)host:\s*\S+.*$', r'\1host: 127.0.0.1         # only reachable through Tailscale (tailscale serve)'),
    (r'(?m)^(\s+)secureCookies:\s*\S+.*$', r'\1secureCookies: true'),
    (r'(?m)^(\s+)allowedOrigins:\s*.*$', r'\1allowedOrigins: ["' + url + '"]'),
]
for pat, rep in rules:
    s, n = re.subn(pat, rep, s, count=1)
    if n != 1:
        sys.exit(f"could not find the line for: {pat}")
open(path, 'w').write(s)
PY
systemctl --user restart hermes-control
sleep 3
code="$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$URL/api/health" || true)"
lan="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://$(hostname -I | awk '{print $1}'):8787/api/health" || true)"
echo "secure address: $code (want 200) | plain home-network http: ${lan:-000} (want 000 = closed)"
if [ "$code" != 200 ]; then
  cp -p "$CFG.bak-ts-$STAMP" "$CFG"; systemctl --user restart hermes-control
  die "secure address stopped working; the old config was restored"
fi
echo
echo "Done. Open $URL on your iPhone and Mac (with the Tailscale app on)."
echo "On iPhone: Safari > Share > Add to Home Screen, for an app icon."
echo "Undo: cp -p $CFG.bak-ts-$STAMP $CFG && systemctl --user restart hermes-control"
