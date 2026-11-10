#!/usr/bin/env bash
# Phase 0 — add the Atomic Fox Media and Vegas Couples Clash workspaces to Hermes Control,
# and rename "Atomic Fox" to "Atomic Fox Mitigation".
#   bash add-business-workspaces.sh
#
# Changes ONLY ~/hermes-control/config.yaml (backed up first) and gives admin users access to the
# new workspaces. Nothing in Hermes is touched. Each workspace gets its own Kanban tenant
# (atomicfoxmedia, couplesclash), so their tasks never show up in another business.
# Undo: copy the backup back and restart: printed at the end.
set -euo pipefail
BASE="$HOME/hermes-control"; CFG="$BASE/config.yaml"
NODE="$HOME/.local/share/hermes-control/node/bin/node"; [ -x "$NODE" ] || NODE="$(command -v node || true)"
STAMP="$(date +%Y%m%d-%H%M%S)"
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }
[ -f "$CFG" ] || die "Hermes Control is not installed ($CFG missing)"
[ -n "$NODE" ] && [ -d "$BASE/app/node_modules/yaml" ] || die "Hermes Control app looks incomplete; reinstall the latest release first"

cp -p "$CFG" "$CFG.bak-ws-$STAMP"; echo "backed up config to $CFG.bak-ws-$STAMP"
( cd "$BASE/app" && "$NODE" - "$CFG" <<'JS'
const fs = require('node:fs'); const YAML = require('yaml');
const file = process.argv[2]; const text = fs.readFileSync(file, 'utf8'); const before = YAML.parse(text);
const team = '[jeff, lena, roxy, harry, scout, debra]';
const add = [
  { slug: 'atomic-fox-media', block: `  - slug: atomic-fox-media\n    name: Atomic Fox Media\n    kanbanTenant: atomicfoxmedia\n    agents: ${team}\n    channels:\n      - { name: atomic-fox-media, agents: ['*'], defaultAgent: jeff }` },
  { slug: 'couples-clash', block: `  - slug: couples-clash\n    name: Vegas Couples Clash\n    kanbanTenant: couplesclash\n    agents: ${team}\n    channels:\n      - { name: couples-clash, agents: ['*'], defaultAgent: jeff }` },
].filter((w) => !(before.workspaces || []).some((x) => x.slug === w.slug));
let lines = text.split('\n');
const i = lines.findIndex((l) => /^workspaces:/.test(l));
if (i < 0) { console.error('no top-level workspaces: block'); process.exit(2); }
let j = i + 1;
while (j < lines.length && (lines[j] === '' || /^[\s#-]/.test(lines[j]))) j++;
while (j > i + 1 && lines[j - 1].trim() === '') j--;
lines.splice(j, 0, ...add.map((w) => w.block));
let out = lines.join('\n');
// Rename the existing Atomic Fox workspace only if it is the plain, unambiguous name.
const af = (before.workspaces || []).find((w) => w.slug === 'atomic-fox');
if (af && af.name === 'Atomic Fox') {
  const re = /(- slug: atomic-fox\n(?:[ \t]+[^\n]*\n)*?[ \t]+name:[ \t]*)Atomic Fox[ \t]*$/m;
  if (re.test(out)) out = out.replace(re, '$1Atomic Fox Mitigation');
}
const after = YAML.parse(out);
const strip = (c) => JSON.stringify({ ...c, workspaces: (c.workspaces || []).map((w) => (w.slug === 'atomic-fox' ? { ...w, name: null } : w)).filter((w) => !['atomic-fox-media', 'couples-clash'].includes(w.slug)) });
if (strip(before) !== strip(after)) { console.error('refusing: other settings would change'); process.exit(3); }
const { parseConfig } = require('./server/dist/config.js'); parseConfig(after);
fs.writeFileSync(file, out);
console.log(`added: ${add.map((w) => w.slug).join(', ') || '(already there)'}; atomic-fox name: ${after.workspaces.find((w) => w.slug === 'atomic-fox')?.name ?? '(no atomic-fox workspace)'}`);
JS
) || { cp -p "$CFG.bak-ws-$STAMP" "$CFG"; die "could not update the config (restored the backup)"; }

systemctl --user restart hermes-control.service; sleep 4
PORT="$(grep -E '^\s*port:' "$CFG" | head -1 | awk '{print $2}')"; PORT="${PORT:-8787}"
code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" || true)"
if [ "$code" != 200 ]; then
  echo "Hermes Control did not come back (health $code); restoring the previous config"
  cp -p "$CFG.bak-ws-$STAMP" "$CFG"; systemctl --user restart hermes-control.service; exit 1
fi
( cd "$BASE/app" && "$NODE" --disable-warning=ExperimentalWarning - "$CFG" <<'JS'
const fs = require('node:fs'); const YAML = require('yaml'); const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const cfg = YAML.parse(fs.readFileSync(process.argv[2], 'utf8'));
const dataDir = (cfg.dataDir || '').replace(/^~/, process.env.HOME);
const db = new DatabaseSync(path.join(dataDir, 'hermes-control.db'));
const admins = db.prepare("SELECT id, username FROM users WHERE role = 'admin'").all();
for (const slug of ['atomic-fox-media', 'couples-clash']) {
  const ws = db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(slug);
  if (!ws) { console.log(`workspace ${slug} not created yet`); continue; }
  for (const u of admins) db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,'owner')").run(ws.id, u.id);
  console.log(`${slug}: access for ${admins.map((u) => u.username).join(', ')}`);
}
JS
)
echo "health: $code (want 200)"
cat <<EOF

Done. In Hermes Control, tap the business name at the top of the chat list to switch between:
Samson HQ, FilmLV, Atomic Fox Mitigation, Atomic Fox Media, Vegas Couples Clash.
Undo: cp -p $CFG.bak-ws-$STAMP $CFG && systemctl --user restart hermes-control
EOF
