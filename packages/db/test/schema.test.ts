import { describe, it, expect } from "vitest";
import { makeDb } from "../src/client";
import { tenant, account, did, contact, form } from "../src/schema";
import { user, queue, queueCall } from "../src/schema";
import { call, recording, recordingRedactionInterval, message, dispatchAttempt } from "../src/schema";

const URL = process.env.TEST_DATABASE_URL ?? "postgres://tas:tas@localhost:5432/tas_test";

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

describe("schema/0002 — operator + queue", () => {
  const db = makeDb(URL);

  it("seeds a user, queue, queue_call round-trip", async () => {
    const [t] = await db.insert(tenant).values({ name: "queue-test" }).returning();
    const [a] = await db.insert(account).values({ tenantId: t.id, name: "QT" }).returning();
    const [u] = await db.insert(user).values({ tenantId: t.id, email: "op@qt.test", role: "operator" }).returning();
    const [q] = await db.insert(queue).values({ accountId: a.id, name: "main", strategy: "fifo" }).returning();
    const [qc] = await db.insert(queueCall).values({
      queueId: q.id,
      callId: crypto.randomUUID(),
      enqueuedAt: new Date(),
    }).returning();
    expect(u.role).toBe("operator");
    expect(q.strategy).toBe("fifo");
    expect(qc.queueId).toBe(q.id);
  });
});

describe("schema/0003 — call+recording+message+dispatch", () => {
  const db = makeDb(URL);

  it("seeds a call, recording, redaction interval, message, dispatch round-trip", async () => {
    const [t] = await db.insert(tenant).values({ name: "call-test" }).returning();
    const [a] = await db.insert(account).values({ tenantId: t.id, name: "CT" }).returning();
    const [d] = await db.insert(did).values({ accountId: a.id, e164: "+15559999" }).returning();
    const [u] = await db.insert(user).values({ tenantId: t.id, email: "op@ct.test", role: "operator" }).returning();
    const [cl] = await db.insert(call).values({
      tenantId: t.id,
      accountId: a.id,
      didId: d.id,
      fromE164: "+15551234",
      startedAt: new Date(),
    }).returning();
    const [r] = await db.insert(recording).values({
      callId: cl.id,
      path: "rec/x.wav",
      startedAt: new Date(),
    }).returning();
    const [ri] = await db.insert(recordingRedactionInterval).values({
      recordingId: r.id,
      startMs: 1000,
      endMs: 2000,
      reason: "operator_pci_pause",
    }).returning();
    const [m] = await db.insert(message).values({
      tenantId: t.id,
      callId: cl.id,
      accountId: a.id,
      operatorId: u.id,
      body: "Caller wants a callback",
    }).returning();
    const [da] = await db.insert(dispatchAttempt).values({
      messageId: m.id,
      channel: "in_app",
      deliveredAt: new Date(),
    }).returning();
    expect(cl.fromE164).toBe("+15551234");
    expect(ri.reason).toBe("operator_pci_pause");
    expect(da.channel).toBe("in_app");
  });
});
