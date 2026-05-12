.PHONY: up test teardown snapshot-results status check-prereqs
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

check-prereqs:
	@test -n "$$ASSEMBLYAI_API_KEY" || { echo "MISSING: ASSEMBLYAI_API_KEY env var"; exit 1; }
	@test -f fixtures/ground-truth.jsonl || { echo "MISSING: fixtures/ground-truth.jsonl"; exit 1; }
	@count=$$(ls fixtures/*.wav 2>/dev/null | wc -l); \
	  test "$$count" -ge 30 || { echo "MISSING: need ≥30 wav fixtures, have $$count"; exit 1; }
	@echo "Prereqs OK"

up:
	docker compose up -d
	@sleep 5
	docker compose ps

test:
	@echo "S4 is BLOCKED on external prereqs:"
	@echo "  - AssemblyAI Universal-3 Pro Medical API key"
	@echo "  - 30 audio fixtures @ 8 kHz μ-law in fixtures/"
	@echo "  - ground-truth.jsonl describing planted PII spans"
	@echo "Run 'make check-prereqs' once prereqs are in place."
	@exit 1

teardown:
	docker compose down -v

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	docker compose logs > results/$(TIMESTAMP)/presidio-logs.txt 2>&1 || true
	@echo "Snapshot at results/$(TIMESTAMP)/"

status:
	@docker compose ps 2>/dev/null || echo "not booted"
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
