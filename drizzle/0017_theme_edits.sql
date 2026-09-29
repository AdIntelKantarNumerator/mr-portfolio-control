-- Who corrected a recurring topic, and when.
--
-- These are read out of meeting notes, and the attribution is a guess in the
-- same way an update's is: the topic was tagged against whichever piece of
-- work the text seemed to be about. Some of them are wrong, and until now
-- there was nothing to do about it — the next pass would rewrite the summary
-- and re-attach it to the same wrong thing.
--
-- WHY THE EDITOR IS RECORDED ON THE ROW
--
-- Two reasons, and the second is the one that matters. A reader needs to know
-- that a line was corrected by a person rather than read off a document,
-- because the two have different authority. And the sync needs to know, so it
-- stops overwriting a correction on its next pass — the same rule the rest of
-- the app already applies to a pinned value.
ALTER TABLE "entity_themes" ADD COLUMN "edited_by" text;--> statement-breakpoint
ALTER TABLE "entity_themes" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
-- Comma-separated, like milestones.edited_fields and for the same reason: it
-- is read whole, written whole, and never queried by element.
ALTER TABLE "entity_themes" ADD COLUMN "edited_fields" text;
