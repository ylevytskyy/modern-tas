# S1 — telephony happy path
.PHONY: up test teardown snapshot-results status

TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

up:
	docker compose up -d
	@echo "Waiting for healthchecks..."
	@for i in $$(seq 1 30); do \
	  if docker compose ps --format json | grep -q '"Health":"unhealthy"'; then \
	    sleep 2; \
	  else break; fi; \
	done
	docker compose ps

test:
	@echo "S1 test harness: see runbook.md — execute phases 1-4 manually for now."
	@echo "Spike-execution time will replace this with an automated driver."
	@false

teardown:
	docker compose down -v

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	docker compose logs > results/$(TIMESTAMP)/all-logs.txt 2>&1
	docker compose ps --format json > results/$(TIMESTAMP)/ps.json
	@echo "Snapshot at results/$(TIMESTAMP)/"

status:
	@docker compose ps
	@echo "---"
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
