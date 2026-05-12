.PHONY: up test teardown snapshot-results status
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

up:
	docker compose up -d
	@sleep 5
	docker compose ps

test:
	@echo "S8 load test: see runbook.md — k6 scenario script lands at spike-execution time."
	@echo "Manual: docker compose --profile driver run k6 run /scripts/sni-flood.js"
	@exit 1

teardown:
	docker compose down -v

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	docker compose logs > results/$(TIMESTAMP)/all-logs.txt 2>&1
	@curl -sS http://localhost:2019/metrics > results/$(TIMESTAMP)/caddy-metrics.txt 2>/dev/null || true
	@curl -sS http://localhost:8404/stats\;csv > results/$(TIMESTAMP)/haproxy-stats.csv 2>/dev/null || true
	@echo "Snapshot at results/$(TIMESTAMP)/"

status:
	@docker compose ps
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
