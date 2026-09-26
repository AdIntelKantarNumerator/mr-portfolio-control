-- Which milestone fields a person set by hand, so a sync stops overwriting them.
--
-- Milestones arrive from Linear and from read program review decks, and both
-- of those write the whole row every time they run. That is right for a row
-- nobody has touched and wrong the moment somebody corrects a date here: the
-- correction survives until the next sync, silently reverts, and the person
-- who made it concludes the app does not save.
--
-- WHY A LIST OF FIELD NAMES AND NOT A FLAG
--
-- A row-level "edited" flag would freeze the whole milestone: correct the
-- date and Linear could no longer update the name, which is a different lie.
-- Recording which fields were touched lets the sync keep doing its job on
-- everything else, which is most of the row most of the time.
--
-- Comma-separated, like project_ids in grouping_suggestions and for the same
-- reason: it is read whole, written whole, and never queried by element.
ALTER TABLE "milestones" ADD COLUMN "edited_by" text;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "edited_fields" text;
