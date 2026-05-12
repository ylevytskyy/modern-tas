.PHONY: up test teardown snapshot-results status
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)
RESULT_DIR := results/$(TIMESTAMP)

up:
	docker compose up -d
	@echo "Waiting for Supavisor to be ready..."
	@sleep 30
	docker compose ps

test:
	@mkdir -p $(RESULT_DIR)
	@echo "Configuring Supavisor pool of size 1 against postgres..."
	@curl -sS -X PUT http://localhost:4000/api/tenants/pot \
	  -H "Authorization: Bearer dev" \
	  -H "Content-Type: application/json" \
	  -d '{"tenant":{"db_host":"postgres","db_port":5432,"db_database":"pot","require_user":false,"users":[{"db_user_alias":"postgres","db_user":"postgres","db_password":"pot","pool_size":1,"mode_type":"transaction"}]}}' \
	  > $(RESULT_DIR)/tenant-create.json || true
	@echo "Running probe..."
	@docker compose exec -T runner sh -c '\
	  export PGPASSWORD=pot; \
	  echo "=== transaction 1 ==="; \
	  psql -h supavisor -p 5432 -U "postgres.pot" -d pot -X -A -c "BEGIN; SET LOCAL app.tenant_id = '\''tenant-A'\''; SELECT current_setting('\''app.tenant_id'\'') AS t1_value, pg_backend_pid() AS pid_t1; COMMIT;"; \
	  echo "=== transaction 2 ==="; \
	  psql -h supavisor -p 5432 -U "postgres.pot" -d pot -X -A -c "BEGIN; SELECT current_setting('\''app.tenant_id'\'', true) AS t2_value, pg_backend_pid() AS pid_t2; COMMIT;"' \
	  > $(RESULT_DIR)/probe-output.txt 2>&1
	@cat $(RESULT_DIR)/probe-output.txt
	@echo ""
	@second_tx=$$(awk '/=== transaction 2 ===/,0' $(RESULT_DIR)/probe-output.txt); \
	 if echo "$$second_tx" | grep -q "tenant-A"; then \
	   echo "RED: Supavisor LEAKED SET LOCAL across transactions"; \
	   echo "Red: Supavisor LEAKED SET LOCAL across transactions on a shared backend. Transaction 2 saw 'tenant-A'. See probe-output.txt." > $(RESULT_DIR)/summary.md; \
	   exit 1; \
	 else \
	   echo "GREEN: Supavisor honoured SET LOCAL boundary"; \
	   echo "Green: Supavisor honoured SET LOCAL boundary; transaction 2 did not see the value set in transaction 1. See probe-output.txt." > $(RESULT_DIR)/summary.md; \
	 fi

teardown:
	docker compose down -v

snapshot-results:
	@echo "Results already in $(RESULT_DIR)/ from make test."
	@ls -la results/

status:
	@docker compose ps
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
