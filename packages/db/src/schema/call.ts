import { pgTable, uuid, text, integer, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant, account, did } from "./tenancy";

export const call = pgTable("call", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
  accountId: uuid("account_id").notNull().references(() => account.id),
  didId: uuid("did_id").notNull().references(() => did.id),
  fromE164: text("from_e164").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endedBy: text("ended_by", { enum: ["caller", "operator", "system"] }),
  routedThrough: text("routed_through").array().notNull().default(sql`ARRAY[]::text[]`),
});

export const recording = pgTable("recording", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
  callId: uuid("call_id").notNull().references(() => call.id),
  path: text("path").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const recordingRedactionInterval = pgTable(
  "recording_redaction_interval",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recordingId: uuid("recording_id").notNull().references(() => recording.id),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms"),
    reason: text("reason", { enum: ["operator_pci_pause", "auto_pii_ml"] }).notNull(),
  },
  (t) => ({
    // I1: at most one open interval (end_ms IS NULL) per recording_id.
    oneOpenPerRecording: uniqueIndex("recording_redaction_interval_one_open_per_recording")
      .on(t.recordingId)
      .where(sql`${t.endMs} IS NULL`),
    // I2: end_ms must be >= start_ms when it is set.
    endMsGteStartMs: check("chk_end_ms_gte_start_ms", sql`${t.endMs} IS NULL OR ${t.endMs} >= ${t.startMs}`),
  }),
);
