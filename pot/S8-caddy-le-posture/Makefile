.PHONY: up test teardown snapshot-results status
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

up:
	docker compose up -d --build
	@echo "Waiting for services to become healthy..."
	@for i in $$(seq 1 30); do \
	  unhealthy=$$(docker compose ps --format json | grep -c 'unhealthy\|"Health":"starting"' || true); \
	  if [ "$$unhealthy" = "0" ]; then \
	    echo "All healthy."; break; \
	  fi; \
	  sleep 2; \
	done
	docker compose ps

test:
	@mkdir -p results/$(TIMESTAMP)
	@./scripts/run-test.sh $(TIMESTAMP)
	@echo "==> Results: results/$(TIMESTAMP)/"

teardown:
	docker compose down -v --remove-orphans

snapshot-results:
	@latest=$$(ls -1t results/ 2>/dev/null | grep -v '^_' | head -1); \
	  if [ -z "$$latest" ]; then echo "No results yet."; exit 1; fi; \
	  echo "Latest results: results/$$latest/"; \
	  ls -la results/$$latest/

status:
	@docker compose ps 2>/dev/null || echo "not booted"
	@ls -1 results/ 2>/dev/null | grep -v '^_' | tail -5 || echo "no results yet"
