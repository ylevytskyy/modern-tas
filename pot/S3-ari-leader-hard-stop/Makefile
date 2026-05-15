# S3 — ARI leader 100 ms hard-stop
.PHONY: up smoke test teardown snapshot-results status

up:
	docker compose up -d --build
	@echo "Waiting for asterisk + redis healthchecks..."
	@for i in $$(seq 1 30); do \
	  if [ "$$(docker compose ps --format json | grep -c '"Health":"healthy"')" -ge 2 ]; then \
	    echo "core services healthy"; break; \
	  fi; \
	  sleep 2; \
	done
	@echo "Waiting 6 s for leader election to settle..."
	@sleep 6
	docker compose ps

smoke:
	@echo "[smoke] current lease holder:"
	@docker compose exec -T redis redis-cli GET pot:ari-leader:asterisk-1 || true
	@echo "[smoke] leader-a last 10 log lines:"
	@docker compose logs --no-color --tail=10 leader-a
	@echo "[smoke] leader-b last 10 log lines:"
	@docker compose logs --no-color --tail=10 leader-b

test:
	bash scripts/run-test.sh

snapshot-results:
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"

teardown:
	docker compose down -v --remove-orphans

status:
	@docker compose ps
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
