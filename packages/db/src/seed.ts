import { sql } from "drizzle-orm";
import { makeDb } from "./client";
import { tenant, account, did, contact, form, user, queue } from "./schema";

const FIXED_IDS = {
  tenant: "11111111-1111-1111-1111-111111111111",
  account: "22222222-2222-2222-2222-222222222222",
  did: "33333333-3333-3333-3333-333333333333",
  contact: "44444444-4444-4444-4444-444444444444",
  form: "55555555-5555-5555-5555-555555555555",
  operator: "66666666-6666-6666-6666-666666666666",
  queue: "77777777-7777-7777-7777-777777777777",
};

const FORM_SCHEMA = {
  fields: [
    { name: "caller_name", label: "Caller name", type: "text" },
    { name: "callback_phone", label: "Callback phone", type: "tel" },
    { name: "message_body", label: "Message", type: "textarea" },
  ],
};

async function main() {
  const db = makeDb(process.env.DATABASE_URL ?? "postgres://tas:tas@localhost:5432/tas");
  console.log(`seed: SEED_PROFILE=${process.env.SEED_PROFILE ?? '(unset)'}`);

  await db.insert(tenant).values({ id: FIXED_IDS.tenant, name: "demo-tenant" }).onConflictDoNothing();
  await db.insert(account).values({ id: FIXED_IDS.account, tenantId: FIXED_IDS.tenant, name: "Demo Account" }).onConflictDoNothing();
  await db.insert(did).values({ id: FIXED_IDS.did, accountId: FIXED_IDS.account, e164: "+15555550100" }).onConflictDoNothing();
  await db.insert(contact).values({ id: FIXED_IDS.contact, accountId: FIXED_IDS.account, name: "Alice Demo", phone: "+15555550200" }).onConflictDoNothing();
  await db.insert(form).values({ id: FIXED_IDS.form, accountId: FIXED_IDS.account, name: "Default", schema: FORM_SCHEMA }).onConflictDoNothing();
  await db.insert(user).values({ id: FIXED_IDS.operator, tenantId: FIXED_IDS.tenant, email: "operator@demo.test", role: "operator" }).onConflictDoNothing();

  if (process.env.SEED_PROFILE === 's4') {
    console.log('seed: applying s4 profile — adding operators B-K');
    const operatorBthroughK = [
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
    const inserted = await db.insert(user).values(
      operatorBthroughK.map((id, i) => ({
        id,
        tenantId: FIXED_IDS.tenant,
        email: `operator-${String.fromCharCode(98 + i)}@s4.test`,
        role: 'operator' as const,
      })),
    ).onConflictDoNothing().returning({ id: user.id });
    console.log(`seed: s4 inserted ${inserted.length} operator rows (returning)`);
    const verify = await db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM "user" WHERE role = 'operator'`);
    console.log(`seed: s4 verify — operator-role users in DB: ${JSON.stringify(verify)}`);
  }

  await db.insert(queue).values({ id: FIXED_IDS.queue, accountId: FIXED_IDS.account, name: "main", strategy: "fifo" }).onConflictDoNothing();

  console.log("seed: ok");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
