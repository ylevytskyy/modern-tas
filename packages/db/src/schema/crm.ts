import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { account } from "./tenancy";

export const contact = pgTable("contact", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id").notNull().references(() => account.id),
  name: text("name").notNull(),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const form = pgTable("form", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id").notNull().references(() => account.id),
  name: text("name").notNull(),
  schema: jsonb("schema").$type<{ fields: Array<{ name: string; label: string; type: string }> }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
