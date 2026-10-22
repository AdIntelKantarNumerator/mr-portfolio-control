-- Who gave an item to its owner, and who was in the meeting (22 October 2026).
-- JSON {by, organizer, attendees}; see src/lib/assignment.ts.
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "assignment" text;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "assignment" text;
