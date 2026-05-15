-- Add tenant_id with a DEFAULT so the column can be added to non-empty tables.
-- The default '11111111-...' is the seeded dev tenant; drop the default after backfill.
-- WARNING: if you have recording/queue_call rows with a DIFFERENT tenant, update them first.
ALTER TABLE "recording" ADD COLUMN "tenant_id" uuid NOT NULL DEFAULT '11111111-1111-1111-1111-111111111111';--> statement-breakpoint
ALTER TABLE "recording" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "queue_call" ADD COLUMN "tenant_id" uuid NOT NULL DEFAULT '11111111-1111-1111-1111-111111111111';--> statement-breakpoint
ALTER TABLE "queue_call" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recording" ADD CONSTRAINT "recording_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "queue_call" ADD CONSTRAINT "queue_call_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "queue_call" ADD CONSTRAINT "queue_call_call_id_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "call"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
