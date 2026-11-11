#!/usr/bin/env bash
# Build a self-contained release tarball: compiled server + web, production node_modules
# (pure JavaScript, no native modules, so it runs on any architecture), deploy files.
#   bash scripts/build-release.sh [outdir]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-release}"
VERSION="$(node -p 'require("./package.json").version')-$(git rev-parse --short HEAD)"
NAME="hermes-control-$VERSION"
STAGE="$(mktemp -d)/$NAME"

npm ci --silent
npm run -s build
mkdir -p "$STAGE"
cp -R server/dist "$STAGE/server-dist"
mkdir -p "$STAGE/server" "$STAGE/web"
mv "$STAGE/server-dist" "$STAGE/server/dist"
cp -R web/dist "$STAGE/web/dist"
cp package.json package-lock.json config.example.yaml .env.example README.md CHANGELOG.md "$STAGE/"
cp -R deploy docs "$STAGE/"
mkdir -p "$STAGE/scripts" && cp scripts/start.sh scripts/audit-hermes.sh "$STAGE/scripts/"
( cd "$STAGE" && npm ci --omit=dev --ignore-scripts --silent )
echo "$VERSION" > "$STAGE/VERSION"
mkdir -p "$OUT"
tar -C "$(dirname "$STAGE")" -czf "$OUT/$NAME.tar.gz" "$NAME"
cp deploy/pi/install.sh "$OUT/install.sh"
( cd "$OUT" && sha256sum "$NAME.tar.gz" install.sh > SHA256SUMS )
echo "$OUT/$NAME.tar.gz"
