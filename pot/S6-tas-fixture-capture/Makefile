.PHONY: up test teardown snapshot-results status check-prereqs
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

check-prereqs:
	@test -n "$$TAS_BASE_URL" || { echo "MISSING: TAS_BASE_URL env var (e.g., https://acme.tas.com)"; exit 1; }
	@test -n "$$TAS_USER" || { echo "MISSING: TAS_USER env var"; exit 1; }
	@test -n "$$TAS_PASS" || { echo "MISSING: TAS_PASS env var"; exit 1; }
	@echo "Prereqs OK"

up:
	@echo "S6 has no boot — capture is a curl loop. Run 'make test' once prereqs are in place."

test:
	@echo "S6 is BLOCKED on external prereqs:"
	@echo "  - live TAS instance access (TAS_BASE_URL, TAS_USER, TAS_PASS)"
	@echo "  - list of CRM-consumed endpoints"
	@echo "Capture script template will land in fixtures/capture.sh.template at spike-execution time."
	@exit 1

teardown:
	docker compose down -v 2>/dev/null || true

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	@echo "Snapshot at results/$(TIMESTAMP)/ — fill manually with quirks.md + redacted capture.sh"

status:
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
	@ls -1 fixtures/v1-xml/ 2>/dev/null | head -10 || echo "no fixtures yet"
