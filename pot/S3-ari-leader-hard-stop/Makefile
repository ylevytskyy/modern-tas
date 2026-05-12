.PHONY: up test teardown snapshot-results status
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

up:
	docker compose up -d --build
	@sleep 10
	docker compose ps

test:
	@echo "S3 chaos test: see runbook.md — pcap capture is host-side, run manually."
	@false

teardown:
	docker compose down -v

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	docker compose logs > results/$(TIMESTAMP)/leader-logs.txt 2>&1
	@echo "Snapshot at results/$(TIMESTAMP)/"

status:
	@docker compose ps
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
