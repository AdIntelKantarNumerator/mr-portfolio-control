-- Client Evaluation (20 November 2026): each 360 user's reporting profiles,
-- counted in the snapshot (iddb_appl.dbo.reporting_profile); their contents are
-- read live from 360 when someone opens them. Zero on other platforms.
ALTER TABLE "ce_users" ADD COLUMN IF NOT EXISTS "profiles" integer DEFAULT 0 NOT NULL;
