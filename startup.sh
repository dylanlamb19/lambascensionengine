#!/bin/sh
set -eu
cd /workspace
# Server-only owner bootstrap (never sent to the browser). Override in real deploys.
export OWNER_EMAIL="${OWNER_EMAIL:-admin@localhost.com}"
export OWNER_PASSWORD="${OWNER_PASSWORD:-changeme}"
export DAILY_ENRICHMENT_CAP="${DAILY_ENRICHMENT_CAP:-10}"
export GLOBAL_DAILY_ENRICHMENT_CAP="${GLOBAL_DAILY_ENRICHMENT_CAP:-10}"
node scripts/preview.mjs stop || true
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
    exit 0
  fi
  sleep 0.5
done
exit 0
