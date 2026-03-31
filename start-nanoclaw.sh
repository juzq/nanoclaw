#!/bin/bash
# start-nanoclaw.sh — Start NanoClaw without systemd
# Usage: ./start-nanoclaw.sh [--debug]
# To stop: kill \$(cat /home/juzi/workspace/nanoclaw/nanoclaw.pid)

set -euo pipefail

cd "/home/juzi/workspace/nanoclaw"

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

pkill -f node

# Stop existing instance if running
if [ -f "/home/juzi/workspace/nanoclaw/nanoclaw.pid" ]; then
  OLD_PID=$(cat "/home/juzi/workspace/nanoclaw/nanoclaw.pid" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping existing NanoClaw (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
fi

echo "Starting NanoClaw..."
NODE_BIN="/home/juzi/.nvm/versions/node/v24.14.1/bin/node"
if [ -n "$DEBUG_MODE" ]; then
  LOG_LEVEL=debug nohup "$NODE_BIN" "/home/juzi/workspace/nanoclaw/dist/index.js" \
    >> "/home/juzi/workspace/nanoclaw/logs/nanoclaw.log" \
    2>> "/home/juzi/workspace/nanoclaw/logs/nanoclaw.error.log" &
  echo "Debug mode enabled"
else
  nohup "$NODE_BIN" "/home/juzi/workspace/nanoclaw/dist/index.js" \
    >> "/home/juzi/workspace/nanoclaw/logs/nanoclaw.log" \
    2>> "/home/juzi/workspace/nanoclaw/logs/nanoclaw.error.log" &
fi

echo $! > "/home/juzi/workspace/nanoclaw/nanoclaw.pid"
echo "NanoClaw started (PID $!)"
echo "Logs: tail -f /home/juzi/workspace/nanoclaw/logs/nanoclaw.log"
