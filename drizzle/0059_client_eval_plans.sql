-- Client Evaluation (23 November 2026): Migration Plans, one per client. Built
-- by the background planner (lib/client-eval/migration/planner.ts) or on
-- demand, and kept with a hash of what they were built from, so a refresh of
-- the client's data marks them out of date.
CREATE TABLE IF NOT EXISTS "ce_plans" (
  "client_id" text PRIMARY KEY,
  "status" text NOT NULL DEFAULT 'queued',
  "depth" text NOT NULL DEFAULT 'light',
  "plan" jsonb,
  "inputs_hash" text,
  "priority" integer NOT NULL DEFAULT 0,
  "requested_at" timestamptz,
  "requested_by" text,
  "started_at" timestamptz,
  "built_at" timestamptz,
  "checked_at" timestamptz,
  "step" text,
  "error" text,
  "duration_ms" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ce_plans_status_idx" ON "ce_plans" ("status", "priority");
