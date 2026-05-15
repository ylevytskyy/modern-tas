.PHONY: poc-up poc-down poc-seed poc-status poc-logs api-dev poc-jwt poc-test-chunk3

COMPOSE_FILE := infra/docker-compose.yml

# Boot the full PoC stack and wait for all services to be healthy.
# After Supavisor is healthy, registers the 'ncall' application tenant
# via the admin API so psql connections with user 'ncall.ncall' work.
poc-up:
	docker compose -f $(COMPOSE_FILE) up -d --build
	@echo "Stack up. Waiting for healthchecks..."
	@./scripts/wait-for-healthy.sh $(COMPOSE_FILE)
	@echo "Registering Supavisor tenant 'ncall'..."
	@$(MAKE) _supavisor-register-tenant

# Internal target: registers the ncall tenant with Supavisor admin API.
# Mints a minimal HS256 JWT (role=admin) and calls PUT /api/tenants/ncall.
# Uses curl — supabase/supavisor:1.1.66 ships curl but NOT wget (live-verified).
# Pattern mirrors S5 probe.sh: docker compose exec -T supavisor curl -sS -X PUT ...
# Idempotent: if tenant already exists, Supavisor returns 200 (update), not error.
_supavisor-register-tenant:
	@HEADER=$$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	PAYLOAD=$$(printf '%s' '{"role":"admin","exp":4070908800}' | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	SIG=$$(printf '%s' "$$HEADER.$$PAYLOAD" | openssl dgst -sha256 -hmac "poc-only-not-prod" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	JWT="$$HEADER.$$PAYLOAD.$$SIG"; \
	docker compose -f $(COMPOSE_FILE) exec -T supavisor \
	  curl -sS -X PUT http://localhost:4000/api/tenants/ncall \
	    -H "Authorization: Bearer $$JWT" \
	    -H "Content-Type: application/json" \
	    -d '{"tenant":{"db_host":"postgres","db_port":5432,"db_database":"ncall","require_user":true,"users":[{"db_user_alias":"ncall","db_user":"ncall","db_password":"ncall","pool_size":10,"mode_type":"transaction","is_manager":true}]}}' \
	  && echo "Supavisor tenant 'ncall' registered (user: ncall.ncall, port: 6543)" \
	  || echo "WARNING: Supavisor tenant registration failed — check logs"

# Tear down the PoC stack and remove volumes.
poc-down:
	docker compose -f $(COMPOSE_FILE) down -v

# Run the database migrations and seed against the running compose Postgres.
# Uses port 5432 directly (not Supavisor 6543) because drizzle-kit migrate
# requires a direct non-pooled connection (Supavisor's transaction-mode pooler
# is incompatible with drizzle-kit's session-level migration queries).
# If you overrode POSTGRES_HOST_PORT, update DATABASE_URL accordingly.
poc-seed:
	DATABASE_URL=postgres://ncall:ncall@localhost:5432/ncall pnpm --filter @ncall/db migrate
	DATABASE_URL=postgres://ncall:ncall@localhost:5432/ncall pnpm --filter @ncall/db seed

# Show current service health status.
poc-status:
	docker compose -f $(COMPOSE_FILE) ps

# Follow logs for all services.
poc-logs:
	docker compose -f $(COMPOSE_FILE) logs -f

# Start the API in debug mode (attach VS Code "Attach to API" on port 9229).
api-dev:
	DATABASE_URL=postgres://ncall.ncall:ncall@localhost:6543/ncall \
	APP_JWT_SECRET=poc-only-not-prod \
	pnpm --filter @ncall/api run dev

# Mint a short-lived HS256 JWT for smoke-testing /v1 endpoints.
# Usage: make poc-jwt  — copy the printed token into Authorization: Bearer <token>
poc-jwt:
	@HEADER=$$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	PAYLOAD=$$(printf '%s' '{"sub":"66666666-6666-6666-6666-666666666666","tenantId":"11111111-1111-1111-1111-111111111111","role":"operator","exp":4070908800}' | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	SIG=$$(printf '%s' "$$HEADER.$$PAYLOAD" | openssl dgst -sha256 -hmac "poc-only-not-prod" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	echo "$$HEADER.$$PAYLOAD.$$SIG"

# Run Chunk 3 integration smoke test.
# Requires: make poc-up + make poc-seed + make api-dev running in another terminal.
# SIPp sends UDP to Kamailio on host port ${KAMAILIO_SIP_HOST_PORT:-5060}.
# STOP-on-conflict: if port 5060 is in use, set KAMAILIO_SIP_HOST_PORT=5061 (or another free port).
poc-test-chunk3:
	DATABASE_URL=postgres://ncall.ncall:ncall@localhost:6543/ncall \
	NATS_URL=nats://localhost:4222 \
	APP_JWT_SECRET=poc-only-not-prod \
	pnpm --filter @ncall/api exec vitest run --config vitest.integration.config.ts
