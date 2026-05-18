/**
 * Integration test: SEED_PROFILE=s4 seeds operators B-K.
 *
 * This test relies on the vitest globalSetup (test/vitest.globalSetup.ts) to
 * spin up a testcontainers Postgres instance and run migrations. The container
 * URL is exposed via process.env.DATABASE_URL.
 *
 * No local Postgres is required — Docker must be available (used by
 * testcontainers). If Docker is unavailable the globalSetup itself will fail;
 * there is no additional skip guard needed here.
 *
 * Isolation strategy: we only DELETE and COUNT the sentinel UUIDs produced by
 * the seed script (66…, 77…771 through 77…77a). This avoids FK violations from
 * users created by schema.test.ts (which have generated IDs and may be
 * referenced by message rows).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import postgres from 'postgres';
import path from 'path';

const SEED_SCRIPT = path.resolve(__dirname, '../src/seed.ts');
const TSX_BIN = path.resolve(__dirname, '../node_modules/.bin/tsx');

// All sentinel operator UUIDs that the seed script may insert.
const OPERATOR_A = '66666666-6666-6666-6666-666666666666';
const OPERATORS_B_TO_K = [
  '77777777-7777-7777-7777-777777777771',
  '77777777-7777-7777-7777-777777777772',
  '77777777-7777-7777-7777-777777777773',
  '77777777-7777-7777-7777-777777777774',
  '77777777-7777-7777-7777-777777777775',
  '77777777-7777-7777-7777-777777777776',
  '77777777-7777-7777-7777-777777777777', // same UUID used for queue FIXED_ID — different table, no conflict
  '77777777-7777-7777-7777-777777777778',
  '77777777-7777-7777-7777-777777777779',
  '77777777-7777-7777-7777-77777777777a',
];
const ALL_SENTINEL_OPERATOR_IDS = [OPERATOR_A, ...OPERATORS_B_TO_K];

function runSeed(profile?: string): void {
  execSync(`${TSX_BIN} ${SEED_SCRIPT}`, {
    env: {
      ...process.env,
      ...(profile ? { SEED_PROFILE: profile } : {}),
    },
    stdio: 'inherit',
  });
}

describe('seed SEED_PROFILE=s4', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    const url = process.env.DATABASE_URL ?? 'postgres://tas:tas@localhost:5432/tas';
    sql = postgres(url);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('seeds 11 operator-role users when SEED_PROFILE=s4', async () => {
    // Remove only sentinel-UUID operators so we do not touch schema-test rows
    // that may be referenced by message FKs.
    await sql`DELETE FROM "user" WHERE id = ANY(${ALL_SENTINEL_OPERATOR_IDS})`;

    runSeed('s4');

    const rows = await sql<{ id: string }[]>`
      SELECT id FROM "user"
      WHERE id = ANY(${ALL_SENTINEL_OPERATOR_IDS})
      ORDER BY id ASC
    `;

    expect(rows.length).toBe(11);
    // Operator A — always present, sorts first (66… < 77…)
    expect(rows[0].id).toBe(OPERATOR_A);
    // Operator B
    expect(rows[1].id).toBe(OPERATORS_B_TO_K[0]);
    // Operator K (last in the list)
    expect(rows[10].id).toBe(OPERATORS_B_TO_K[OPERATORS_B_TO_K.length - 1]);
  });

  it('seeds only 1 sentinel operator when SEED_PROFILE is unset', async () => {
    await sql`DELETE FROM "user" WHERE id = ANY(${ALL_SENTINEL_OPERATOR_IDS})`;

    runSeed(); // no SEED_PROFILE — default profile

    const rows = await sql<{ id: string }[]>`
      SELECT id FROM "user"
      WHERE id = ANY(${ALL_SENTINEL_OPERATOR_IDS})
      ORDER BY id ASC
    `;

    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(OPERATOR_A);
  });
});
