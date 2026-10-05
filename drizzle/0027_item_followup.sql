-- Following work-in-progress items through to the end (5 October 2026).
--
-- Blockers, decisions and action items were recorded and then never touched:
-- of 251 action items 10 were ever closed, and 1 of 241 open ones had changed
-- since it was written. These columns carry what Yaara needs to follow them
-- up and what the dashboards need to rank and age them. See
-- src/lib/importance.ts and src/lib/item-activity.ts.
--
--   importance_factors  JSON array of factor keys Yaara tagged ("blocks_project", ...)
--   importance_reasons  JSON [{factor, why, quote, source, url}] - the "why is this important" popup
--   importance_score    0-100, computed from the factors, mentions and the adjustment
--   importance_adjust   what people added or took away by hand (+/-), kept apart so a re-score does not undo it
--   mentions            how many places it has been raised or referred to
--   last_activity_at    the last real update: evidence, a reply, a status change, an edit, a score change.
--                       Not a nudge being sent, and not the first automatic score. Open and untouched
--                       for 7 days is "inactive".
--   nudged_at           when its owner was last reminded
--   merged_into         the ref of the item this was a duplicate of

ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "importance_factors" text;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "importance_reasons" text;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "importance_score" integer;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "importance_adjust" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "mentions" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "nudged_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "merged_into" text;
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "importance_factors" text;
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "importance_reasons" text;
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "importance_score" integer;
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "importance_adjust" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "mentions" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "nudged_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "merged_into" text;
--> statement-breakpoint
-- Action items had no history of their own; changes went only to Activity.
CREATE TABLE IF NOT EXISTS "action_item_events" (
  "id" text PRIMARY KEY NOT NULL,
  "action_item_id" text NOT NULL REFERENCES "action_items"("id") ON DELETE CASCADE,
  -- raised | updated | done | dropped | reopened | merged | owner | importance | nudged
  "kind" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "actor" text,
  "note" text,
  "source_title" text,
  "source_url" text,
  "recorded_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_item_events_item_idx" ON "action_item_events" USING btree ("action_item_id");
--> statement-breakpoint
-- What has actually happened so far is the best starting point for "last
-- activity": the newest event, or the last edit.
UPDATE "decisions" AS d SET "last_activity_at" = GREATEST(d."updated_at", COALESCE(e.latest, d."updated_at"))
FROM (SELECT "decision_id", MAX(COALESCE("occurred_at", "created_at")) AS latest FROM "decision_events" GROUP BY "decision_id") AS e
WHERE e."decision_id" = d."id";
--> statement-breakpoint
UPDATE "decisions" SET "last_activity_at" = "updated_at" WHERE "id" NOT IN (SELECT "decision_id" FROM "decision_events");
--> statement-breakpoint
UPDATE "action_items" SET "last_activity_at" = "updated_at";
--> statement-breakpoint
-- Each time it was raised, discussed or updated somewhere is a mention.
UPDATE "decisions" AS d SET "mentions" = GREATEST(1, e.n)
FROM (SELECT "decision_id", COUNT(*)::integer AS n FROM "decision_events" WHERE "kind" IN ('raised', 'discussed', 'updated') GROUP BY "decision_id") AS e
WHERE e."decision_id" = d."id";
--> statement-breakpoint
-- Each existing action item's creation, so its history popup is not empty.
INSERT INTO "action_item_events" ("id", "action_item_id", "kind", "occurred_at", "actor", "note", "source_title", "source_url", "recorded_by")
SELECT gen_random_uuid()::text, "id", 'raised', COALESCE("raised_at", "created_at"), NULL, NULL, "source_title", "source_url", "authored_by"
FROM "action_items";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decisions_activity_idx" ON "decisions" USING btree ("status", "last_activity_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_items_activity_idx" ON "action_items" USING btree ("status", "last_activity_at");
