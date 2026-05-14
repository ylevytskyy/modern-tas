import { describe, it, expect } from "vitest";
import { makeDb } from "../src/client";
import { tenant, account, did, contact, form } from "../src/schema";

const URL = process.env.TEST_DATABASE_URL ?? "postgres://ncall:ncall@localhost:5432/ncall_test";

describe("schema/0001 — tenancy + CRM", () => {
  const db = makeDb(URL);

  it("seeds a tenant, account, did, contact, form round-trip", async () => {
    const [t] = await db.insert(tenant).values({ name: "acme" }).returning();
    const [a] = await db.insert(account).values({ tenantId: t.id, name: "Acme Co" }).returning();
    const [d] = await db.insert(did).values({ accountId: a.id, e164: "+15550001" }).returning();
    const [c] = await db.insert(contact).values({ accountId: a.id, name: "Alice", phone: "+15550002" }).returning();
    const [f] = await db.insert(form).values({ accountId: a.id, name: "Default", schema: { fields: [] } }).returning();
    expect(t.id).toBeDefined();
    expect(d.e164).toBe("+15550001");
    expect(c.name).toBe("Alice");
    expect(f.schema).toEqual({ fields: [] });
  });
});
