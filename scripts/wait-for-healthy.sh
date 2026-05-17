#!/usr/bin/env bash
set -euo pipefail

# Accept one or more compose files as arguments.
# Each is passed as a separate -f flag to docker compose.
# Falls back to the default infra compose file if none supplied.
if [ $# -eq 0 ]; then
  COMPOSE_ARGS=(-f infra/docker-compose.yml)
  COMPOSE_DESC="infra/docker-compose.yml"
else
  COMPOSE_ARGS=()
  COMPOSE_DESC=""
  for f in "$@"; do
    COMPOSE_ARGS+=(-f "$f")
    COMPOSE_DESC="${COMPOSE_DESC:+$COMPOSE_DESC, }$f"
  done
fi

TIMEOUT="${TIMEOUT_SECONDS:-180}"
START=$(date +%s)

echo "Waiting for all services in $COMPOSE_DESC to become healthy..."

while :; do
  # Parse health status from docker compose ps NDJSON output.
  # Docker Compose v2+ emits one JSON object per line (NDJSON), not a JSON array.
  # We read line-by-line to avoid json.load() breaking on multi-line input.
  STATUS=$(docker compose "${COMPOSE_ARGS[@]}" ps --format json 2>/dev/null || echo "")
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
    docker compose "${COMPOSE_ARGS[@]}" ps
    exit 1
  fi

  echo "  still waiting (${ELAPSED}s): $UNHEALTHY"
  sleep 2
done
