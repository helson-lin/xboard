#!/usr/bin/env bash
# Build the dashboard and deploy the bundle into ./static (served by app.py).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> installing frontend deps"
(cd web && npm install)

echo "==> building dashboard"
(cd web && npm run build)

echo "==> deploying dist -> static/"
rm -rf static/assets static/index.html static/favicon.svg static/icons.svg
cp -r web/dist/. static/

echo "==> done. start with ./run.sh"
