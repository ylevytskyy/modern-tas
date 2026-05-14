import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { account } from "./tenancy";

export const queue = pgTable("queue", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id").notNull().references(() => account.id),
  name: text("name").notNull(),
  strategy: text("strategy", {
    enum: ["fifo", "priority", "sticky_last_operator", "least_recent", "longest_idle"],
  }).notNull(),
});

export const queueCall = pgTable("queue_call", {
  id: uuid("id").defaultRandom().primaryKey(),
  queueId: uuid("queue_id").notNull().references(() => queue.id),
  callId: uuid("call_id").notNull(),
  enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).notNull(),
  dequeuedAt: timestamp("dequeued_at", { withTimezone: true }),
  attempts: text("attempts").array().notNull().default(sql`ARRAY[]::text[]`),
});
