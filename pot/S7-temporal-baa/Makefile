.PHONY: up test teardown snapshot-results status
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

up:
	@echo "S7 has no boot — sales/legal correspondence only. See README and runbook."

test:
	@echo "S7 is BLOCKED on external action: sales contact with Temporal."
	@echo "Track progress in results/correspondence.md."
	@exit 1

teardown:
	@true

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	@cp results/correspondence.md results/$(TIMESTAMP)/correspondence.md 2>/dev/null || true
	@cp results/baa-letter.pdf results/$(TIMESTAMP)/baa-letter.pdf 2>/dev/null || true
	@echo "Snapshot at results/$(TIMESTAMP)/"

status:
	@test -f results/baa-letter.pdf && echo "BAA letter: present" || echo "BAA letter: not yet received"
	@test -f results/correspondence.md && echo "Correspondence log: present" || echo "Correspondence log: not yet started"
