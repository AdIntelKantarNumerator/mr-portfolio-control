-- Where a release's date came from (11 November 2026). INS-659 had no target
-- date of its own; Scott asked for the project's target date to stand in, and
-- the calendar says so. "ticket" or "project"; null when there is no date.
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "target_date_from" text;
