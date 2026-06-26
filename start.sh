#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8765}"
PID_FILE=".dashboard.pid"
LOG_FILE="dashboard.log"

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "Dashboard is already running (PID $pid) on http://0.0.0.0:${PORT}"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
  echo "Port ${PORT} is already in use. Stop the other service or set PORT to a different value."
  exit 1
fi

if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

echo "Starting LLM Benchmark Dashboard on http://0.0.0.0:${PORT}"
nohup uvicorn server:app --host 0.0.0.0 --port "$PORT" >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

sleep 1
if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Dashboard started (PID $(cat "$PID_FILE"))."
  echo "  URL:  http://localhost:${PORT}"
  echo "  Logs: ${LOG_FILE}"
else
  echo "Failed to start dashboard. Check ${LOG_FILE} for details."
  rm -f "$PID_FILE"
  exit 1
fi
