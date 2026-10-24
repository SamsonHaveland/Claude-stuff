#!/bin/bash
# Installs dependencies for the vendored SenseNova skills (.claude/skills/sn-*)
# in Claude Code cloud sessions. Local machines are left untouched.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

SKILLS="$CLAUDE_PROJECT_DIR/.claude/skills"

# Python deps from every skill's requirements.txt. Playwright is pinned to the
# version matching the container's pre-installed Chromium (/opt/pw-browsers).
reqs=()
for f in "$SKILLS"/sn-*/requirements.txt; do reqs+=(-r "$f"); done
pip install --quiet --disable-pip-version-check "${reqs[@]}" "playwright==1.63.0"

# Node deps for the sn-ppt-standard HTML->PPTX exporter. Browser download is
# skipped; its browser picker falls back to the pre-installed Chromium.
cd "$SKILLS/sn-ppt-standard/scripts/export_pptx"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund --silent
