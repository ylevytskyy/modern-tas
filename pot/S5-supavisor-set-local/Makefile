.PHONY: up test teardown snapshot-results status
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)
RESULT_DIR := results/$(TIMESTAMP)

up:
	docker compose up -d
	@echo "Waiting for Supavisor to be ready..."
	@sleep 10
	docker compose ps

test:
	@mkdir -p $(RESULT_DIR)
	@sh fixtures/probe.sh $(RESULT_DIR)

teardown:
	docker compose down -v

snapshot-results:
	@echo "Results already in $(RESULT_DIR)/ from make test."
	@ls -la results/

status:
	@docker compose ps
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
