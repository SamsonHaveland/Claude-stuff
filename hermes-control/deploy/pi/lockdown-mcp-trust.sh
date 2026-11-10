#!/usr/bin/env bash
# Phase 0 — make every connected service (MCP server) ask before it writes.
#   bash lockdown-mcp-trust.sh
#
# Hermes trusts connected services fully unless told otherwise ("Missing trust = full",
# tools/mcp_tool.py). This sets `trust: untrusted` on each MCP server of each agent, so every
# write-capable call (send, post, edit, delete) needs your approval; read-only calls still run
# without asking. Scheduled jobs cannot approve, so their write calls are refused (draft only).
# Each agent's config.yaml is backed up first. Restarting the gateway (needed for the change to
# load) is offered at the end; Telegram reconnects by itself in a few seconds.
# NOTE: email sent through the google-workspace / himalaya SKILLS is not an MCP server and is
# not covered by this — see the Phase 1 email plan.
set -uo pipefail
HB="$(command -v hermes || echo "$HOME/.local/bin/hermes")"
H="${HERMES_HOME:-$HOME/.hermes}"
STAMP="$(date +%Y%m%d-%H%M%S)"
PROFILES="default $(ls "$H/profiles" 2>/dev/null | grep -vE '^\.|^default$' | tr '\n' ' ')"
changed=0; skipped=0; backups=()

for P in $PROFILES; do
  D="$H"; [ "$P" = default ] || D="$H/profiles/$P"
  [ -f "$D/config.yaml" ] || continue
  mode="$("$HB" -p "$P" config get approvals.mode --json 2>/dev/null | tr -d '"')"
  [ "$mode" = off ] && echo "WARNING [$P]: approvals.mode is OFF — untrusted servers will NOT ask on this agent. Tell me before changing it."
  names="$("$HB" -p "$P" config get mcp_servers --json 2>/dev/null | python3 -c '
import json,sys
try: d=json.load(sys.stdin) or {}
except Exception: d={}
for n,v in (d.items() if isinstance(d,dict) else []):
    t=(v or {}).get("trust","full") if isinstance(v,dict) else "full"
    print(n+"\t"+str(t))')"
  [ -z "$names" ] && { echo "[$P] no connected services"; continue; }
  cp -p "$D/config.yaml" "$D/config.yaml.bak-trust-$STAMP"; backups+=("$D/config.yaml.bak-trust-$STAMP")
  while IFS=$'\t' read -r name trust; do
    [ -z "$name" ] && continue
    if [ "$trust" = untrusted ]; then echo "[$P] $name: already untrusted"; continue; fi
    if [[ "$name" == *.* ]]; then echo "[$P] $name: SKIPPED (dot in name; set trust: untrusted by hand)"; skipped=$((skipped+1)); continue; fi
    if "$HB" -p "$P" config set "mcp_servers.$name.trust" untrusted >/dev/null 2>&1 \
       && [ "$("$HB" -p "$P" config get "mcp_servers.$name.trust" --json 2>/dev/null | tr -d '"')" = untrusted ]; then
      echo "[$P] $name: full -> untrusted"; changed=$((changed+1))
    else
      echo "[$P] $name: FAILED to change (left as $trust)"; skipped=$((skipped+1))
    fi
  done <<< "$names"
done

echo
echo "Changed: $changed   Skipped/failed: $skipped"
if [ "${#backups[@]}" -gt 0 ]; then
  echo "Backups:"; printf '  %s\n' "${backups[@]}"
  echo "Undo: copy each backup back over its config.yaml, then: hermes gateway restart"
fi
if [ "$changed" -gt 0 ]; then
  printf '\nThe change loads when the gateway restarts (Telegram pauses a few seconds).\nRestart the gateway now? Type yes: '
  read -r ans
  if [ "$ans" = yes ]; then "$HB" gateway restart && sleep 8 && "$HB" gateway status 2>&1 | head -5; else echo "Not restarted. Run 'hermes gateway restart' when convenient."; fi
fi
