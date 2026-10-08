-- What changed, on each history entry (8 October 2026).
--
-- A later meeting that changed a decision or an action item overwrote it in
-- place: the body was replaced and nothing kept the old one, so "what did we
-- decide before, and where did that change?" had no answer. Each history entry
-- now carries the fields it changed, from and to. Where and when were already
-- there (meeting/source and occurred_at), so together they say what changed,
-- in which meeting, and when.
--
--   changes   JSON [{"field": "title", "from": "...", "to": "..."}], or null
--             when the entry changed nothing (a mention, a nudge).

ALTER TABLE "decision_events" ADD COLUMN IF NOT EXISTS "changes" text;
--> statement-breakpoint
ALTER TABLE "action_item_events" ADD COLUMN IF NOT EXISTS "changes" text;
