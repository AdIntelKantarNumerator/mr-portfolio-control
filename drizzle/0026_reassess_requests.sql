-- "Reassess now" on a home page card, carried to Yaara and back.
--
-- She cannot be called, so the button leaves a request here and she collects
-- it over GET /api/agent/reassess, as she collects chat questions. See
-- src/lib/reassess-rules.ts. Rows are deleted two days after they are made.

CREATE TABLE IF NOT EXISTS "reassess_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "requested_by" text NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- queued | working | done | failed
  "status" text DEFAULT 'queued' NOT NULL,
  "claimed_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "note" text,
  "error" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reassess_requests_status_idx" ON "reassess_requests" USING btree ("status","requested_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reassess_requests_entity_idx" ON "reassess_requests" USING btree ("entity_type","entity_id");
