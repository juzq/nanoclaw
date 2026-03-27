#!/bin/bash
# start-nanoclaw.sh — Start NanoClaw without systemd
# To stop: kill \$(cat /home/juzi/workspace/nanoclaw/nanoclaw.pid)

set -euo pipefail

cd "/home/juzi/workspace/nanoclaw"

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
nohup "/home/juzi/.nvm/versions/node/v24.14.1/bin/node" "/home/juzi/workspace/nanoclaw/dist/index.js" \
  >> "/home/juzi/workspace/nanoclaw/logs/nanoclaw.log" \
  2>> "/home/juzi/workspace/nanoclaw/logs/nanoclaw.error.log" &

echo $! > "/home/juzi/workspace/nanoclaw/nanoclaw.pid"
echo "NanoClaw started (PID $!)"
echo "Logs: tail -f /home/juzi/workspace/nanoclaw/logs/nanoclaw.log"
