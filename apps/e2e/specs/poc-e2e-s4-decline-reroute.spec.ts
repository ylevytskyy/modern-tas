import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { runScenario } from '../src/run-scenario.js';
import { OperatorPage } from '../pages/OperatorPage.js';
import { getDb, schema, closeDb } from '../src/lib/db.js';
import { WsOperator } from '../src/lib/wsOperator.js';
import { eq } from 'drizzle-orm';

// S-4: 10-reroute decline chain.
// Operator A declines via browser click; operators B-J each decline via POST;
// operator K receives the screen-pop, ending the test.
// Assertions: attempts chain length 10, all 'declined', ordered A→J;
// tenantId correct on call + queue_call; p95 < 200ms over 10 dispatch samples.

// --- Constants ---

const SEEDED_TENANT_ID = '11111111-1111-1111-1111-111111111111'; // FIXED_IDS.tenant in seed.ts

// Operator A is the browser-based operator (NEXT_PUBLIC_OPERATOR_ID on the Next.js page).
const OPERATOR_A = '66666666-6666-6666-6666-666666666666';

// Operators B-K: 10 Node WS clients (seeded under SEED_PROFILE=s4).
const OPERATORS_B_THROUGH_K: string[] = [
  '77777777-7777-7777-7777-777777777771',
  '77777777-7777-7777-7777-777777777772',
  '77777777-7777-7777-7777-777777777773',
  '77777777-7777-7777-7777-777777777774',
  '77777777-7777-7777-7777-777777777775',
  '77777777-7777-7777-7777-777777777776',
  '77777777-7777-7777-7777-777777777777',
  '77777777-7777-7777-7777-777777777778',
  '77777777-7777-7777-7777-777777777779',
  '77777777-7777-7777-7777-77777777777a',
];

// API and WS base URLs — align with Docker Compose port mapping for the API.
// API is on 3000 (per `infra/docker-compose.all-in.yml: ports: ["3000:3000"]`);
// 3001 is the Next.js web container, which does not expose /v1/dev/operator-token.
const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:3000';
const WS_BASE = process.env.E2E_WS_BASE_URL ?? 'ws://localhost:3000/ws';

// SIPp hold time is ~25s; add 10s for assertion + cleanup.
const SCENARIO_WALL_CLOCK_MS = 60_000;

// Per-iteration screen-pop budget — kept tight so a stuck dispatch fails fast
// rather than burning the full outer timeout.
const SCREEN_POP_BUDGET_MS = 2_000;

// Initial wait for operator A's screen-pop — slightly more generous since it
// also covers INVITE → Asterisk → NATS → dispatch chain startup.
const INITIAL_SCREEN_POP_BUDGET_MS = 5_000;

// --- JWT helper ---

/**
 * Mint a short-lived JWT for the given operator by calling the dev endpoint.
 * The dev.controller.ts route is under /dev (under /v1 prefix) and returns
 * { token: string }.
 */
async function mintOperatorJwt(operatorId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/dev/operator-token?operatorId=${operatorId}`);
  if (!res.ok) {
    throw new Error(`mintOperatorJwt failed for ${operatorId}: HTTP ${res.status}`);
  }
  const body = await res.json() as { token: string };
  return body.token;
}

// --- p95 helper ---

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// --- Teardown ---

test.afterAll(async () => { await closeDb(); });

// --- Spec ---

test('S-4 decline reroute — 10-reroute chain, p95 < 200ms, HC#4 closed', async ({ page }) => {
  test.setTimeout(SCENARIO_WALL_CLOCK_MS);

  const sipCallId = uuidv4();

  // ── Step 1: Connect Operator A via Playwright browser page ──────────────────
  const opA = new OperatorPage(page);
  await opA.goto(OPERATOR_A); // operatorId arg is forward-compat; page uses env NEXT_PUBLIC_OPERATOR_ID
  await opA.waitForWsOpen();

  // ── Step 2: Connect Operators B-K via per-operator WS clients ───────────────
  // Each WS client needs its OWN JWT so the API gateway registers it as a
  // distinct operatorId (derived from JWT `sub` claim). A shared JWT would
  // register all 10 clients as the same operator, corrupting the dispatch queue.
  const wsClients: WsOperator[] = [];
  for (const opId of OPERATORS_B_THROUGH_K) {
    const jwt = await mintOperatorJwt(opId);
    const wsOp = new WsOperator(WS_BASE, jwt);
    await wsOp.register(opId);
    wsClients.push(wsOp);
  }

  // ── Step 3: Fire SIPp INVITE (async — 25s hold) ─────────────────────────────
  const sippPromise = runScenario({ scenario: 's4-decline-reroute', callId: sipCallId });

  try {
    // ── Step 4: Operator A receives screen-pop → E.164 visible → click Decline ──
    const { callId } = await opA.waitForScreenPop({ timeoutMs: INITIAL_SCREEN_POP_BUDGET_MS });
    expect(callId).toMatch(/^[0-9a-f-]{36}$/);

    // HC#4 assertion: E.164-format caller number rendered in the screen-pop banner.
    await expect(page.getByText(/\+\d/)).toBeVisible({ timeout: 2_000 });

    await opA.decline();

    // Decline button must disappear (component un-mounts or transitions away after decline).
    await expect(page.getByTestId('decline-call')).not.toBeVisible({ timeout: 2_000 });

    // ── Step 5: Operators B-J each receive screen-pop and POST decline ───────────
    // wsClients[0] = operator B, …, wsClients[8] = operator J  (9 iterations).
    for (let i = 0; i < 9; i++) {
      const pop = await wsClients[i].awaitScreenPop({ timeoutMs: SCREEN_POP_BUDGET_MS });
      expect(pop.callId).toBe(callId);
      const { status } = await wsClients[i].decline(API_BASE, callId);
      expect(status).toBe(200);
    }

    // ── Step 6: Operator K (wsClients[9]) receives screen-pop — test ends here ──
    const popK = await wsClients[9].awaitScreenPop({ timeoutMs: SCREEN_POP_BUDGET_MS });
    expect(popK.callId).toBe(callId);

    // ── Step 7: DB assertions ────────────────────────────────────────────────────
    const db = getDb();

    // queue_call: exactly one row for this call.
    const queueRows = await db
      .select()
      .from(schema.queueCall)
      .where(eq(schema.queueCall.callId, callId))
      .limit(1);
    expect(queueRows.length, 'queue_call row exists').toBe(1);

    const queueRow = queueRows[0];

    // attempts array: length 10, all 'declined', ordered A→J.
    // Each element is a JSON-encoded string stored in a Postgres text[] column.
    const attempts = queueRow.attempts.map((s) => JSON.parse(s) as { operatorId: string; outcome: string });

    expect(attempts.length, 'exactly 10 decline attempts').toBe(10);
    expect(
      attempts.every((a) => a.outcome === 'declined'),
      'all attempts have outcome=declined',
    ).toBe(true);
    expect(
      attempts.map((a) => a.operatorId),
      'operatorIds ordered A→J',
    ).toEqual([OPERATOR_A, ...OPERATORS_B_THROUGH_K.slice(0, 9)]);

    // tenantId correct on queue_call and call rows.
    // S-4 uses CANCEL (no answer), so no recording row is ever created.
    // assertTenant would throw on the missing recording row — check fields directly instead.
    const callRows = await db
      .select()
      .from(schema.call)
      .where(eq(schema.call.id, callId))
      .limit(1);
    expect(callRows.length, 'call row exists').toBe(1);
    expect(callRows[0].tenantId, 'call.tenantId matches seeded tenant').toBe(SEEDED_TENANT_ID);
    expect(queueRows[0].tenantId, 'queue_call.tenantId matches seeded tenant').toBe(SEEDED_TENANT_ID);

    // ── Step 8: Dispatch latency p95 < 200ms ─────────────────────────────────────
    // Internal endpoint has NO /v1 prefix — excluded by main.ts setGlobalPrefix.
    const latencyRes = await fetch(
      `${API_BASE}/internal/dispatch-latencies?callId=${callId}`,
      { headers: { 'x-internal-token': process.env.INTERNAL_API_TOKEN ?? '' } },
    );
    expect(latencyRes.status, 'dispatch-latencies endpoint responds 200').toBe(200);
    const { samples } = await latencyRes.json() as { samples: number[] };
    expect(samples.length, 'at least 10 latency samples').toBeGreaterThanOrEqual(10);

    const latencyP95 = p95(samples.slice(-10));
    expect(latencyP95, `p95 latency ${latencyP95}ms < 200ms`).toBeLessThan(200);
  } finally {
    // ── Cleanup: always close WS connections and await SIPp, even on failure ─────
    for (const w of wsClients) {
      try { await w.close(); } catch { /* ignore individual close errors */ }
    }
    // Await SIPp's CANCEL + wind-down (~25s from INVITE). Timeout accommodated by
    // test.setTimeout(35_000). SIPp exit code is NOT asserted — Docker bridge NAT
    // pathology prevents Asterisk's 100 Trying from reaching SIPp in some envs,
    // causing SIPp to abort with exit code 1 (same caveat as s1–s3 specs).
    try { await sippPromise; } catch { /* ignore SIPp non-zero exit on failure */ }
  }
});
