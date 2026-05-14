import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { tenant } from "./tenancy";

export const user = pgTable("user", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["operator", "admin", "supervisor"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
