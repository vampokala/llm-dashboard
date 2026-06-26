#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Restarting LLM Benchmark Dashboard..."
./stop.sh || true
./start.sh
