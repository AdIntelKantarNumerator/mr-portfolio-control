-- The Linear status last announced for a release (16 November 2026). Scott
-- asked for a post in #mr-production-deployments whenever a release ticket's
-- status changes. A release already announced takes its current status as the
-- one announced, so the change is not read as a status change for every
-- release at once.
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "announced_status" text;
--> statement-breakpoint
UPDATE "releases" SET "announced_status" = coalesce("status", 'none') WHERE "announced_key" IS NOT NULL AND "announced_status" IS NULL;
