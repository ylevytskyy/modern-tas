#!/bin/sh
# S5 probe — verifies Supavisor honours the `SET LOCAL` boundary across
# transactions on a server backend reused via transaction-mode pooling.
#
# Configures the tenant via Supavisor's admin API (HS256 JWT signed with
# API_JWT_SECRET) with pool_size=1, then runs TWO transactions in ONE psql
# client session: pool_size=1 + same client → identical backend pid for both
# transactions, which is the only way to actually test the SET LOCAL boundary.
#
# Exit codes: 0 Green, 1 Red, 2 Inconclusive.

set -eu

RESULT_DIR="$1"
SECRET="${API_JWT_SECRET:-dev}"

# Mint admin JWT (HS256, role=admin, far-future exp).
HEADER=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | openssl base64 -A | tr '+/' '-_' | tr -d '=')
PAYLOAD=$(printf '%s' '{"role":"admin","exp":4070908800}' | openssl base64 -A | tr '+/' '-_' | tr -d '=')
SIG=$(printf '%s' "$HEADER.$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
JWT="$HEADER.$PAYLOAD.$SIG"

echo "Configuring Supavisor tenant 'pot' (require_user=true, pool_size=1, transaction mode)..."
curl -sS -X PUT http://localhost:4000/api/tenants/pot \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"tenant":{"db_host":"postgres","db_port":5432,"db_database":"pot","require_user":true,"users":[{"db_user_alias":"postgres","db_user":"postgres","db_password":"pot","pool_size":1,"mode_type":"transaction","is_manager":true}]}}' \
  > "$RESULT_DIR/tenant-create.json"
echo

echo "Running probe — two transactions, ONE psql client session (pool_size=1 → shared backend)..."
docker compose exec -T runner sh -c "export PGPASSWORD=pot; psql -h supavisor -p 5432 -U 'postgres.pot' -d pot -X -A <<'SQL'
\echo '=== transaction 1 ==='
BEGIN;
SET LOCAL app.tenant_id = 'tenant-A';
SELECT current_setting('app.tenant_id') AS t1_value, pg_backend_pid() AS pid_t1;
COMMIT;
\echo '=== transaction 2 ==='
BEGIN;
SELECT current_setting('app.tenant_id', true) AS t2_value, pg_backend_pid() AS pid_t2;
COMMIT;
SQL
" > "$RESULT_DIR/probe-output.txt" 2>&1

cat "$RESULT_DIR/probe-output.txt"
echo

PID_T1=$(awk -F'|' '/^t1_value\|pid_t1$/{getline; print $2}' "$RESULT_DIR/probe-output.txt")
PID_T2=$(awk -F'|' '/^t2_value\|pid_t2$/{getline; print $2}' "$RESULT_DIR/probe-output.txt")
T2_VAL=$(awk -F'|' '/^t2_value\|pid_t2$/{getline; print $1}' "$RESULT_DIR/probe-output.txt")

echo "Parsed: pid_t1=$PID_T1 pid_t2=$PID_T2 t2_value='$T2_VAL'"

if [ -z "$PID_T1" ] || [ -z "$PID_T2" ]; then
  echo "INCONCLUSIVE: failed to parse pids from probe output"
  printf '%s\n' "Inconclusive: failed to parse pids from probe output. See probe-output.txt." > "$RESULT_DIR/summary.md"
  exit 2
fi

if [ "$PID_T1" != "$PID_T2" ]; then
  echo "INCONCLUSIVE: transactions did NOT share a backend (pid_t1=$PID_T1, pid_t2=$PID_T2)"
  printf '%s\n' "Inconclusive: transactions did not share a backend (pid_t1=$PID_T1, pid_t2=$PID_T2). SET LOCAL boundary cannot be evaluated when the second transaction lands on a different backend. See probe-output.txt." > "$RESULT_DIR/summary.md"
  exit 2
fi

if [ -n "$T2_VAL" ]; then
  echo "RED: Supavisor LEAKED SET LOCAL across transactions on backend pid=$PID_T1. Transaction 2 saw '$T2_VAL'."
  printf '%s\n' "Red: Supavisor LEAKED SET LOCAL across transactions on a shared backend (pid=$PID_T1). Transaction 2 saw '$T2_VAL' instead of NULL/empty. See probe-output.txt. ADR-0018 fallback (PgBouncer 1.22+) required." > "$RESULT_DIR/summary.md"
  exit 1
fi

echo "GREEN: Supavisor honoured SET LOCAL boundary on shared backend pid=$PID_T1. Transaction 2 saw NULL/empty."
printf '%s\n' "Green: Supavisor honoured SET LOCAL boundary across transactions on a shared backend (pid_t1=pid_t2=$PID_T1); transaction 2 read NULL/empty for app.tenant_id. See probe-output.txt." > "$RESULT_DIR/summary.md"
