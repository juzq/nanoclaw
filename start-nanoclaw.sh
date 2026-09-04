#!/bin/bash
# start-nanoclaw.sh — Start NanoClaw without systemd
# Usage: ./start-nanoclaw.sh [--debug]
# To stop: kill $(cat "$(dirname "$0")/nanoclaw.pid")

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Parse arguments
DEBUG_MODE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --debug)
      DEBUG_MODE="debug"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--debug]"
      exit 1
      ;;
  esac
done

# Stop existing instance if running
if [ -f "$SCRIPT_DIR/nanoclaw.pid" ]; then
  OLD_PID=$(cat "$SCRIPT_DIR/nanoclaw.pid" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping existing NanoClaw (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
fi

echo "Starting NanoClaw..."
NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then
  echo "Error: node not found in PATH. Please ensure node is installed and accessible."
  exit 1
fi
if [ -n "$DEBUG_MODE" ]; then
  LOG_LEVEL=debug nohup "$NODE_BIN" "$SCRIPT_DIR/dist/index.js" \
    >> "$SCRIPT_DIR/logs/nanoclaw.log" \
    2>> "$SCRIPT_DIR/logs/nanoclaw.error.log" &
  echo "Debug mode enabled"
else
  nohup "$NODE_BIN" "$SCRIPT_DIR/dist/index.js" \
    >> "$SCRIPT_DIR/logs/nanoclaw.log" \
    2>> "$SCRIPT_DIR/logs/nanoclaw.error.log" &
fi

echo $! > "$SCRIPT_DIR/nanoclaw.pid"
echo "NanoClaw started (PID $!)"
echo "Logs: tail -f $SCRIPT_DIR/logs/nanoclaw.log"
