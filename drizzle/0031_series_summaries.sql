-- Meeting series, summary-first (12 October 2026).
--
-- The series page was a list of every item that moved. What a chair needs is
-- the last session summarised, an agenda for the next one, and the lists only
-- on request. Yaara writes a summary when she reads a session's notes (she has
-- the text; the portfolio never stores it); the portfolio writes the agenda
-- from the summaries and the items.
--
--   meeting_series.goals          what the series is for, in the chair's words;
--                                 the agenda is judged against it
--   meeting_series.slack_channel  where summaries and agendas are posted, if anywhere
--   series_summaries              one per session document: Yaara's Markdown,
--                                 and a person's edit kept beside it, never overwritten
--   series_agendas                a proposed agenda for a session date, with a
--                                 fingerprint of what it was built from, so it is
--                                 regenerated only when something changed
--   suggested_done_*              on blockers, decisions and action items: Yaara
--                                 thinks it is finished but was not sure enough to
--                                 close it; a person accepts or dismisses

ALTER TABLE "meeting_series" ADD COLUMN IF NOT EXISTS "goals" text;
--> statement-breakpoint
ALTER TABLE "meeting_series" ADD COLUMN IF NOT EXISTS "slack_channel" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "series_summaries" (
  "id" text PRIMARY KEY NOT NULL,
  "series_id" text NOT NULL REFERENCES "meeting_series"("id") ON DELETE CASCADE,
  "meeting" text NOT NULL,
  "session_day" text NOT NULL,
  "document_external_id" text NOT NULL,
  "document_title" text,
  "document_url" text,
  "revision" text,
  "markdown" text NOT NULL,
  "model" text,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "edited_markdown" text,
  "edited_by" text,
  "edited_at" timestamp with time zone,
  "notes_changed_at" timestamp with time zone,
  "posted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "series_summaries_doc_uq" ON "series_summaries" USING btree ("series_id", "document_external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "series_summaries_day_idx" ON "series_summaries" USING btree ("series_id", "session_day");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "series_agendas" (
  "id" text PRIMARY KEY NOT NULL,
  "series_id" text NOT NULL REFERENCES "meeting_series"("id") ON DELETE CASCADE,
  "for_day" text NOT NULL,
  "content" text NOT NULL,
  "fingerprint" text,
  "model" text,
  "generated_by" text,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "posted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "series_agendas_day_uq" ON "series_agendas" USING btree ("series_id", "for_day");
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "suggested_done_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "suggested_done_note" text;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "suggested_done_source" text;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "suggested_done_url" text;
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "suggested_done_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "suggested_done_note" text;
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "suggested_done_source" text;
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "suggested_done_url" text;
--> statement-breakpoint
-- What the first series is for, as far as the notes say; Scott to correct.
UPDATE "meeting_series" SET "goals" = 'Get Insights Studio on GPC data ready for the November 1 release: settle the data model (hierarchy, spend allocation, V2 tables), agree the Nov 1 scope for each module (Creative Intel first), and build and review the prototype session by session.'
WHERE "id" = 'series-is-gpc' AND "goals" IS NULL;
