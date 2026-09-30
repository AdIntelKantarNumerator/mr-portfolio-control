-- Marking a recurring discussion resolved.
--
-- The Discussions page lists what keeps coming up in meetings and has not
-- become a decision or a blocker. Some of it gets settled in the room and is
-- never formally recorded anywhere, and until now it stayed on the page for as
-- long as it was mentioned in the window, crowding out what is still live.
--
-- A resolved topic is hidden by default, not deleted: the page can still show
-- it, and the record of what was discussed stays whole.
--
-- WHY reopened_at
--
-- A topic resolved on Monday that comes up again in Thursday's meeting was not
-- resolved. The register upsert clears resolved_at when a mention is dated
-- after it, and stamps reopened_at so the page can say it came back, which is
-- the signal the page exists to show.
ALTER TABLE "entity_themes" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entity_themes" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "entity_themes" ADD COLUMN "reopened_at" timestamp with time zone;
