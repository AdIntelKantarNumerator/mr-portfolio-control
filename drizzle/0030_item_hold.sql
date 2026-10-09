-- On hold until a date (9 October 2026).
--
-- "A35 won't be addressed until December": the item stays open, but nobody
-- is reminded about it until the date, and from the date on it is reminded
-- about again. Null means not on hold. Stored as the start of that day.

ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "held_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN IF NOT EXISTS "held_until" timestamp with time zone;
