-- Enforce at most one open interval (end_ms IS NULL) per recording.
-- Guards against double-fire of pause (concurrent requests, retry storms).
--> statement-breakpoint
CREATE UNIQUE INDEX "recording_redaction_interval_one_open_per_recording"
  ON "recording_redaction_interval" ("recording_id")
  WHERE "end_ms" IS NULL;
--> statement-breakpoint
-- Reject negative-duration intervals: end_ms must be >= start_ms when set.
ALTER TABLE "recording_redaction_interval"
  ADD CONSTRAINT "chk_end_ms_gte_start_ms"
  CHECK ("end_ms" IS NULL OR "end_ms" >= "start_ms");
