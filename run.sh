#!/usr/bin/env bash
# Start XBoard (backend + built dashboard) on port 8765 by default.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
exec python3 -m uvicorn app:app --host 0.0.0.0 --port "$PORT" --log-level warning
