# S2 — queue dequeue latency
.PHONY: up smoke test test-redis-contention test-nats-lag teardown snapshot-results status

up:
	docker compose up -d --build
	@echo "Waiting for healthchecks..."
	@for i in $$(seq 1 30); do \
	  if docker compose ps --format json | grep -q '"Health":"healthy"' && \
	     [ "$$(docker compose ps --format json | grep -c '"Health":"healthy"')" -ge 4 ]; then \
	    echo "all core services healthy"; break; \
	  fi; \
	  sleep 2; \
	done
	docker compose ps

# 1-call smoke: place a single INVITE and verify arbiter sees StasisStart + accept round-trip works.
smoke:
	@echo "[smoke] placing 1 INVITE via SIPp"
	docker compose --profile driver run --rm sipp \
	  sipp -r 1 -m 1 -l 1 \
	    -sf /sipp/200-callers.xml \
	    asterisk:5060 || true
	@echo "[smoke] arbiter last 30 log lines:"
	@docker compose logs --no-color --tail=30 arbiter

test:
	bash scripts/run-test.sh

test-redis-contention:
	bash scripts/run-contention-redis.sh

test-nats-lag:
	bash scripts/run-contention-nats.sh

snapshot-results:
	@echo "Snapshots are emitted by scripts/run-test.sh into results/<TS>/."
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"

teardown:
	docker compose --profile driver down -v --remove-orphans
	docker compose down -v

status:
	@docker compose ps
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
