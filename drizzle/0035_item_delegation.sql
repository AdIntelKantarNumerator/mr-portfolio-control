-- A pending delegation on an item (26 October 2026): asked, not yet accepted
-- or declined. JSON {to, toRef, by, byRef, at, note, sentAt}; see
-- src/lib/delegation.ts. The owner changes only when it is accepted.
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "delegation" text;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "delegation" text;
