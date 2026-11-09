#!/bin/bash
# Starts the API, then nginx. If either stops, the container exits so Docker can restart it.
set -euo pipefail

mkdir -p "${VOL_DATA_DIR:-/data}"
python3 /opt/app/vol_api.py --port 8770 &
API_PID=$!

for i in $(seq 1 30); do
  if curl -fsS -H "Host: localhost" http://127.0.0.1:8770/health >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null || [ "$i" -eq 30 ]; then
    echo "[entrypoint] ERROR: the API did not start"
    exit 1
  fi
  sleep 1
done

nginx -g 'daemon off;' &
NGINX_PID=$!
trap 'kill "$API_PID" "$NGINX_PID" 2>/dev/null || true' TERM INT EXIT
wait -n "$API_PID" "$NGINX_PID"
echo "[entrypoint] a process stopped; exiting"
exit 1
