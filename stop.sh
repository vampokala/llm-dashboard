#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8765}"
PID_FILE=".dashboard.pid"

stop_pid() {
  local pid="$1"
  if ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi

  echo "Stopping dashboard (PID $pid)..."
  kill "$pid" 2>/dev/null || true

  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done

  echo "Force stopping dashboard (PID $pid)..."
  kill -9 "$pid" 2>/dev/null || true
}

stopped=false

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  if stop_pid "$pid"; then
    stopped=true
  fi
  rm -f "$PID_FILE"
fi

if [[ "$stopped" == false ]]; then
  pids="$(pgrep -f "${PWD}/.venv/bin/uvicorn server:app --host 0.0.0.0 --port ${PORT}" 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    pids="$(ss -tlnp 2>/dev/null | grep ":${PORT} " | grep -oP 'pid=\K[0-9]+' || true)"
  fi

  if [[ -z "$pids" ]]; then
    echo "Dashboard is not running on port ${PORT}."
    exit 0
  fi

  while read -r pid; do
    [[ -n "$pid" ]] || continue
    stop_pid "$pid" && stopped=true
  done <<< "$pids"
fi

if [[ "$stopped" == true ]]; then
  echo "Dashboard stopped."
else
  echo "Dashboard is not running on port ${PORT}."
fi
