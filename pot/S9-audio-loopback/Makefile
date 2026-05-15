.PHONY: image up down restart logs cli endpoints channels contacts dialplan

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
