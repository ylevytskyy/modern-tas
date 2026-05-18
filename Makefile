.PHONY: poc-up poc-down poc-seed poc-status poc-logs api-dev poc-jwt poc-test-chunk3 poc-up-all-docker poc-test-all-docker-up poc-e2e-s1 poc-e2e-s3 poc-e2e

COMPOSE_FILE := infra/docker-compose.yml

# Boot the full PoC stack and wait for all services to be healthy.
# After Supavisor is healthy, registers the 'tas' application tenant
# via the admin API so psql connections with user 'tas.tas' work.
poc-up:
	docker compose -f $(COMPOSE_FILE) up -d --build
	@echo "Stack up. Waiting for healthchecks..."
	@./scripts/wait-for-healthy.sh $(COMPOSE_FILE)
	@echo "Registering Supavisor tenant 'tas'..."
	@$(MAKE) _supavisor-register-tenant

# Internal target: registers the tas tenant with Supavisor admin API.
# Mints a minimal HS256 JWT (role=admin) and calls PUT /api/tenants/tas.
# Uses curl — supabase/supavisor:1.1.66 ships curl but NOT wget (live-verified).
# Pattern mirrors S5 probe.sh: docker compose exec -T supavisor curl -sS -X PUT ...
# Idempotent: if tenant already exists, Supavisor returns 200 (update), not error.
_supavisor-register-tenant:
	@HEADER=$$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	PAYLOAD=$$(printf '%s' '{"role":"admin","exp":4070908800}' | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	SIG=$$(printf '%s' "$$HEADER.$$PAYLOAD" | openssl dgst -sha256 -hmac "poc-only-not-prod" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	JWT="$$HEADER.$$PAYLOAD.$$SIG"; \
	docker compose -f $(COMPOSE_FILE) exec -T supavisor \
	  curl -sS -X PUT http://localhost:4000/api/tenants/tas \
	    -H "Authorization: Bearer $$JWT" \
	    -H "Content-Type: application/json" \
	    -d '{"tenant":{"db_host":"postgres","db_port":5432,"db_database":"tas","require_user":true,"users":[{"db_user_alias":"tas","db_user":"tas","db_password":"tas","pool_size":10,"mode_type":"transaction","is_manager":true}]}}' \
	  && echo "Supavisor tenant 'tas' registered (user: tas.tas, port: 6543)" \
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
	DATABASE_URL=postgres://tas:tas@localhost:5432/tas pnpm --filter @tas/db migrate
	DATABASE_URL=postgres://tas:tas@localhost:5432/tas pnpm --filter @tas/db seed

# Show current service health status.
poc-status:
	docker compose -f $(COMPOSE_FILE) ps

# Follow logs for all services.
poc-logs:
	docker compose -f $(COMPOSE_FILE) logs -f

# Start the API in debug mode (attach VS Code "Attach to API" on port 9229).
api-dev:
	DATABASE_URL=postgres://tas.tas:tas@localhost:6543/tas \
	APP_JWT_SECRET=poc-only-not-prod \
	pnpm --filter @tas/api run dev

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
	DATABASE_URL=postgres://tas.tas:tas@localhost:6543/tas \
	NATS_URL=nats://localhost:4222 \
	APP_JWT_SECRET=poc-only-not-prod \
	pnpm --filter @tas/api exec vitest run --config vitest.integration.config.ts

# Boot the full stack including apps as compose services (CI parity).
# Requires INTERNAL_API_TOKEN and APP_JWT_SECRET in env.
poc-up-all-docker:
	docker compose -f $(COMPOSE_FILE) -f infra/docker-compose.all-in.yml up -d --build
	@./scripts/wait-for-healthy.sh $(COMPOSE_FILE) infra/docker-compose.all-in.yml
	@echo "Registering Supavisor tenant 'tas'..."
	@$(MAKE) _supavisor-register-tenant

# Curl smoke against the api service running in all-in-docker mode.
poc-test-all-docker-up:
	@curl -sf http://localhost:3000/v1/health > /dev/null \
	  && echo "api /v1/health OK on all-in-docker" \
	  || (echo "api /v1/health NOT reachable — check docker compose logs api" && exit 1)

# Run the S-1 e2e spec. Assumes either poc-up + host dev OR poc-up-all-docker.
poc-e2e-s1:
	pnpm --filter @tas/e2e run test:e2e:s1

# Run the S-3 e2e spec. Assumes either poc-up + host dev OR poc-up-all-docker.
poc-e2e-s3:
	pnpm --filter @tas/e2e run test:e2e:s3

# Run all e2e scenario specs sequentially.
poc-e2e: poc-e2e-s1 poc-e2e-s3
