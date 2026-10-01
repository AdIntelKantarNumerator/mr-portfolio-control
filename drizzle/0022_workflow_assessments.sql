-- The Workflow Assessment chat: one row per question asked of the map.
--
-- An answer is kept with a record of exactly what it relied on — the
-- components it named, with the time each was last edited, and the
-- connections it walked — so the page can tell an answer given against an
-- older map from a current one, and say what changed, rather than leaving a
-- stale answer looking authoritative.
--
-- No foreign keys to workflow_components: a component that is later deleted
-- is precisely the change an old answer needs to report, and a cascade would
-- erase the evidence.

CREATE TABLE IF NOT EXISTS "workflow_assessments" (
  "id" text PRIMARY KEY NOT NULL,
  "question" text NOT NULL,
  "asked_by" text,
  "asked_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- model | keywords
  "method" text NOT NULL,
  "model" text,
  "answer" text NOT NULL,
  "relied" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_assessments_asked_idx" ON "workflow_assessments" USING btree ("asked_at");
