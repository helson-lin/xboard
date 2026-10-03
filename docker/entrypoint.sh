#!/bin/sh
set -eu
umask 077
mkdir -p "$XBOARD_DATA_DIR" "$XBOARD_CONFIG_DIR"
if [ ! -f "$XBOARD_CONFIG_DIR/tag_rules.json" ]; then
    cp /app/defaults/tag_rules.json "$XBOARD_CONFIG_DIR/tag_rules.json"
fi
if [ "${1:-serve}" = "serve" ]; then
    # SQLite, in-process jobs and rate limiters require a single API worker.
    exec python -m uvicorn app:app --host 0.0.0.0 --port "${PORT:-8765}" --workers 1 --log-level info
fi
exec "$@"
