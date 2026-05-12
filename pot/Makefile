# PoT dispatcher — forwards per-spike targets to each spike's Makefile.
# Usage: make help · make status · make up-S5-supavisor-set-local · make test-S5-supavisor-set-local

SPIKES := S1-telephony-happy-path \
          S2-queue-dequeue-latency \
          S3-ari-leader-hard-stop \
          S4-redaction-accuracy \
          S5-supavisor-set-local \
          S6-ncall-fixture-capture \
          S7-temporal-baa \
          S8-caddy-le-posture

ACTIONS := up test teardown snapshot-results status

.PHONY: help status all-targets $(foreach a,$(ACTIONS),$(addprefix $(a)-,$(SPIKES)))

help:
	@echo "PoT spike dispatcher"
	@echo ""
	@echo "Per-spike targets (replace <spike> with one of):"
	@for s in $(SPIKES); do echo "  $$s"; done
	@echo ""
	@echo "Actions:"
	@for a in $(ACTIONS); do echo "  make $$a-<spike>"; done
	@echo ""
	@echo "Aggregate:"
	@echo "  make status            # show ps + results dir for all spikes"
	@echo "  make all-targets       # list every dispatch target"

status:
	@for s in $(SPIKES); do \
	  echo "=== $$s ==="; \
	  $(MAKE) -C $$s status 2>/dev/null || echo "  (no Makefile or not booted)"; \
	done

all-targets:
	@for a in $(ACTIONS); do for s in $(SPIKES); do echo "$$a-$$s"; done; done

# Pattern targets: forward to per-spike Makefile.
$(foreach a,$(ACTIONS),$(eval $(a)-%: ; @$$(MAKE) -C $$* $(a)))
