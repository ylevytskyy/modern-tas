# S1 — telephony happy path. Layer 1 (signaling): Kamailio HA dispatch
# + ARI screen-pop. See README for scope; Layer 2 (media via rtpengine)
# is deferred and only attempted after Layer 1 is Green.
.PHONY: up test teardown snapshot-results status images

TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

images:
	docker build -t pot-s1/asterisk:local   asterisk-image
	docker build -t pot-s1/kamailio:local   kamailio-image
	docker build -t pot-s1/sipp:local       sipp-image
	docker build -t pot-s1/subscriber:local subscriber

up: images
	docker compose up -d
	@echo "[make up] waiting for asterisk + kamailios to report healthy..."
	@for i in $$(seq 1 60); do \
	  unhealthy=$$(docker compose ps --format '{{.Name}} {{.Health}}' | awk '$$2=="unhealthy" || $$2=="starting"' | wc -l); \
	  if [ "$$unhealthy" -eq 0 ]; then \
	    echo "[make up] all services healthy"; break; \
	  fi; \
	  sleep 2; \
	done
	docker compose ps

test:
	bash scripts/run-test.sh
	@last=$$(ls -1dt results/2* 2>/dev/null | head -1); \
	if [ -n "$$last" ]; then bash scripts/summarise.sh "$$last"; fi

snapshot-results:
	@echo "[make snapshot-results] run-test.sh already snapshots; verifying..."
	@ls -1dt results/2* 2>/dev/null | head -3 || echo "no results yet"

teardown:
	docker compose down -v

status:
	@docker compose ps
	@echo "---"
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
