import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { tenant, account } from "./tenancy";
import { user } from "./operator";
import { call } from "./call";

export const message = pgTable("message", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
  callId: uuid("call_id").notNull().references(() => call.id),
  accountId: uuid("account_id").notNull().references(() => account.id),
  operatorId: uuid("operator_id").notNull().references(() => user.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const dispatchAttempt = pgTable("dispatch_attempt", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id").notNull().references(() => message.id),
  channel: text("channel", { enum: ["in_app", "email", "sms", "push", "voice"] }).notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  error: text("error"),
  failureReason: text("failure_reason"),
});
