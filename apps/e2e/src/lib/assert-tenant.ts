import { eq } from 'drizzle-orm';
import { getDb, schema } from './db.js';

// Tables that have both a tenantId and a callId (or primary key id for `call`).
// Note: dispatchAttempt is excluded — it has only messageId, not callId/tenantId.
const TABLES: Array<{ name: string; table: any }> = [
  { name: 'call', table: schema.call },
  { name: 'recording', table: schema.recording },
  { name: 'queueCall', table: schema.queueCall },
];

export async function assertTenant(expectedTenantId: string, callId: string): Promise<void> {
  const db = getDb();
  for (const t of TABLES) {
    // `call` is looked up by primary key `id`; the others have foreign key `callId`.
    const whereCol = t.name === 'call' ? (t.table as any).id : (t.table as any).callId;
    const rows = await db.select().from(t.table).where(eq(whereCol, callId));

    if (rows.length === 0 && t.name !== 'queueCall') {
      // queueCall is the only optional table — present in S-1 but treated as soft
      throw new Error(`assertTenant: no rows in ${t.name} for callId=${callId}`);
    }
    for (const row of rows) {
      const actual = (row as any).tenantId ?? (row as any).tenant_id;
      if (actual !== expectedTenantId) {
        throw new Error(
          `assertTenant: ${t.name} row pk=${(row as any).id} has tenantId=${actual}, expected ${expectedTenantId}`,
        );
      }
    }
  }
}
