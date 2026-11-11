#!/usr/bin/env bash
# Start Hermes Control with secrets loaded from .env (git-ignored, chmod 600).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
exec node --disable-warning=ExperimentalWarning server/dist/index.js
