#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${1:-infra/docker-compose.yml}"
TIMEOUT="${TIMEOUT_SECONDS:-180}"
START=$(date +%s)

echo "Waiting for all services in $COMPOSE_FILE to become healthy..."

while :; do
  # Parse health status from docker compose ps NDJSON output.
  # Docker Compose v2+ emits one JSON object per line (NDJSON), not a JSON array.
  # We read line-by-line to avoid json.load() breaking on multi-line input.
  STATUS=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null || echo "")
  UNHEALTHY=$(echo "$STATUS" | \
    python3 -c "
import sys, json
data = [json.loads(line) for line in sys.stdin if line.strip()]
# Services are unhealthy if Health field is not 'healthy' and not '' (no healthcheck)
bad = [s.get('Service', '?') for s in data
       if s.get('Health', '') not in ('healthy', '')]
print('\n'.join(bad))
" 2>/dev/null || true)

  if [ -z "$UNHEALTHY" ]; then
    echo "all services healthy (or no healthcheck)"
    exit 0
  fi

  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -gt "$TIMEOUT" ]; then
    echo "TIMEOUT after ${TIMEOUT}s waiting for: $UNHEALTHY"
    docker compose -f "$COMPOSE_FILE" ps
    exit 1
  fi

  echo "  still waiting (${ELAPSED}s): $UNHEALTHY"
  sleep 2
done
