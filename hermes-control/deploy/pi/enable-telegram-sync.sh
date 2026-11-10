#!/usr/bin/env bash
# Show Jeff's and Debra's Telegram chats in Hermes Control, ready for two-way sync.
#   bash enable-telegram-sync.sh
#
# Changes ONLY ~/hermes-control/config.yaml (backed up first): turns on the Telegram copy for
# jeff and debra. Two-way stays OFF until you flip it in Settings > Telegram.
# Nothing in Hermes is changed. No Telegram message is sent by this script.
# How it works: docs/INTEGRATION_PLAN.md ("Telegram sync").
set -euo pipefail
BASE="$HOME/hermes-control"
CFG="$BASE/config.yaml"
NODE="$HOME/.local/share/hermes-control/node/bin/node"
STAMP="$(date +%Y%m%d-%H%M%S)"
PROFILES="${HC_TELEGRAM_PROFILES:-jeff debra}"
die() { printf '\nSTOPPED: %s\nNothing was changed.\n' "$*" >&2; exit 1; }

[ -f "$CFG" ] || die "Hermes Control is not installed ($CFG missing)"
[ -x "$NODE" ] || NODE="$(command -v node || true)"
[ -n "$NODE" ] || die "Node for Hermes Control not found"
[ -d "$BASE/app/node_modules/yaml" ] || die "Hermes Control app looks incomplete (no node_modules/yaml); reinstall the latest release first"
HB="$(command -v hermes || echo "$HOME/.local/bin/hermes")"
for P in $PROFILES; do
  "$HB" -p "$P" send --help >/dev/null 2>&1 || die "'hermes -p $P send' is not available"
  grep -qE '^TELEGRAM_HOME_CHANNEL=.+' "$HOME/.hermes/profiles/$P/.env" 2>/dev/null \
    || die "$P has no Telegram home chat. Open $P's bot in Telegram and send /sethome, then rerun."
done

cp -p "$CFG" "$CFG.bak-tg-$STAMP"
echo "backed up config to $CFG.bak-tg-$STAMP"
( cd "$BASE/app" && "$NODE" - "$CFG" $PROFILES <<'JS'
const fs = require('node:fs');
const YAML = require('yaml');
const [file, ...profiles] = process.argv.slice(2);
const text = fs.readFileSync(file, 'utf8');
const cfg = YAML.parse(text) || {};
const slugs = (cfg.workspaces || []).map((w) => w.slug);
const workspace = slugs.includes('general') ? 'general' : slugs[0];
if (!workspace) { console.error('no workspaces in config'); process.exit(2); }
const keep = (cfg.telegramMirror || []).filter((t) => !profiles.includes(t.profile));
const list = [...keep, ...profiles.map((p) => ({ profile: p, enabled: true, twoWay: false, pollSeconds: 5, workspace }))];
const block = ['telegramMirror:', ...list.map((t) => '  - ' + YAML.stringify(t, { collectionStyle: 'flow', lineWidth: 0 }).trim())].join('\n') + '\n';
// Replace only the top-level telegramMirror block; every other line stays exactly as it was.
const lines = text.split('\n');
const i = lines.findIndex((l) => /^telegramMirror:/.test(l));
let out;
if (i < 0) out = text.replace(/\n*$/, '\n\n') + block;
else {
  let j = i + 1;
  while (j < lines.length && (lines[j] === '' || /^[\s-]/.test(lines[j]))) j++;
  while (j > i + 1 && lines[j - 1] === '') j--;
  out = [...lines.slice(0, i), block.trimEnd(), ...lines.slice(j)].join('\n');
}
const check = YAML.parse(out);
if (JSON.stringify({ ...check, telegramMirror: null }) !== JSON.stringify({ ...cfg, telegramMirror: null })) { console.error('refusing: other settings would change'); process.exit(3); }
fs.writeFileSync(file, out);
console.log(`Telegram copy on for ${profiles.join(', ')} in workspace "${workspace}" (two-way off)`);
JS
) || { cp -p "$CFG.bak-tg-$STAMP" "$CFG"; die "could not update the config (restored the backup)"; }

grep -qE '^\s+mode:\s*live' "$CFG" || echo "NOTE: hermes.mode is not 'live' in $CFG, so nothing will show until it is."
systemctl --user restart hermes-control.service
sleep 4
PORT="$(grep -E '^\s*port:' "$CFG" | head -1 | awk '{print $2}')"; PORT="${PORT:-8787}"
code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" || true)"
echo "health: $code (want 200)"
[ "$code" = 200 ] || { echo "Hermes Control did not come back; restoring the previous config"; cp -p "$CFG.bak-tg-$STAMP" "$CFG"; systemctl --user restart hermes-control.service; exit 1; }

cat <<EOF

Done. In Hermes Control you now have "Jeff on Telegram" and "Debra on Telegram" chats.
To also send from the app to Telegram: Settings > Telegram > Two-way.
Undo: cp -p $CFG.bak-tg-$STAMP $CFG && systemctl --user restart hermes-control
EOF
