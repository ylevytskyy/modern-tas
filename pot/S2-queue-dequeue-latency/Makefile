# S2 — queue dequeue latency
.PHONY: up test teardown snapshot-results status

TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

up:
	docker compose up -d --build
	@echo "Waiting for healthchecks..."
	@sleep 15
	docker compose ps

test:
	@echo "S2 test harness: see runbook.md — full driver lands at spike-execution time."
	@echo "Manual smoke: docker compose --profile driver run sipp /usr/bin/sipp -sf /sipp/200-callers.xml asterisk:5060"
	@false

teardown:
	docker compose down -v

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	docker compose logs > results/$(TIMESTAMP)/all-logs.txt 2>&1
	@echo "Snapshot at results/$(TIMESTAMP)/"

status:
	@docker compose ps
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
