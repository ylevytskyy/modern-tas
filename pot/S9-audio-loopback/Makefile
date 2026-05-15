.PHONY: image up down restart logs cli endpoints channels contacts dialplan sipp-image register-probe

image:
	docker compose build

up:
	docker compose up -d --build
	@echo "Waiting for Asterisk to settle..."
	@for i in 1 2 3 4 5 6; do \
		if docker exec s9-asterisk asterisk -rx "core show version" >/dev/null 2>&1; then \
			echo "Asterisk ready."; \
			docker exec s9-asterisk asterisk -rx "core show version"; \
			exit 0; \
		fi; \
		sleep 2; \
	done; \
	echo "Asterisk did not become ready within 12 s — see 'make logs'"; \
	exit 1

down:
	docker compose down

restart: down up

logs:
	docker compose logs -f asterisk

cli:
	docker exec -it s9-asterisk asterisk -rvvvvv

endpoints:
	docker exec s9-asterisk asterisk -rx "pjsip show endpoints"

channels:
	docker exec s9-asterisk asterisk -rx "pjsip show channels"

contacts:
	docker exec s9-asterisk asterisk -rx "pjsip show contacts"

dialplan:
	docker exec s9-asterisk asterisk -rx "dialplan show tas-loopback"

sipp-image:
	docker compose --profile probe build sipp

# Deterministic G1 check — runs REGISTER for alice + bob via SIPp from
# inside the compose network. Reaches asterisk by service name on
# 5060/udp (intra-network, no host port mapping involved → unlike the
# softphone path on the Mac which goes through Docker Desktop's NAT).
# Exit 0 = both REGISTER calls completed (401-challenge handled, 200 OK
# received). Non-zero = at least one failed.
register-probe:
	@echo "=== Probe (intra-compose-network): REGISTER alice ==="
	docker compose --profile probe run --rm sipp \
	  -sf /scenarios/register.xml \
	  -s alice -au alice -ap alice-s9-pot \
	  -m 1 -r 1 -rp 1000 \
	  -trace_err -trace_msg \
	  -timeout 10s -recv_timeout 5000 \
	  asterisk:5060
	@echo ""
	@echo "=== Probe (intra-compose-network): REGISTER bob ==="
	docker compose --profile probe run --rm sipp \
	  -sf /scenarios/register.xml \
	  -s bob -au bob -ap bob-s9-pot \
	  -m 1 -r 1 -rp 1000 \
	  -trace_err -trace_msg \
	  -timeout 10s -recv_timeout 5000 \
	  asterisk:5060
	@echo ""
	@echo "=== Post-probe: pjsip contacts ==="
	@docker exec s9-asterisk asterisk -rx "pjsip show contacts"

# Same scenario, run from the Mac host (brew-installed sipp) against
# 127.0.0.1:5060 — exercises the Docker-Desktop port-forward path that
# Linphone/Zoiper use. If `register-probe` is Green but this is Red,
# the bug is in the port-forward layer, not pjsip.
register-probe-host:
	@which sipp >/dev/null || { echo "sipp not installed — run: brew install sipp"; exit 1; }
	@echo "=== Probe (Mac→port-forward): REGISTER alice ==="
	sipp -sf scenarios/register.xml \
	  -s alice -au alice -ap alice-s9-pot \
	  -m 1 -r 1 -rp 1000 \
	  -p 5061 \
	  -timeout 10s -recv_timeout 5000 \
	  -trace_err -trace_msg -error_file /tmp/s9-host-err.log \
	  127.0.0.1:5060
	@echo ""
	@echo "=== Probe (Mac→port-forward): REGISTER bob ==="
	sipp -sf scenarios/register.xml \
	  -s bob -au bob -ap bob-s9-pot \
	  -m 1 -r 1 -rp 1000 \
	  -p 5062 \
	  -timeout 10s -recv_timeout 5000 \
	  -trace_err -trace_msg -error_file /tmp/s9-host-err.log \
	  127.0.0.1:5060
	@echo ""
	@echo "=== Post-probe: pjsip contacts ==="
	@docker exec s9-asterisk asterisk -rx "pjsip show contacts"
