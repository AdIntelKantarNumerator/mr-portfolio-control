-- Whether a release is a ticket or a whole project (12 November 2026). Scott
-- labelled a Linear project, Audio Processing in Creative Central, as a
-- Production Deployment and expected it on the calendar; a labelled project
-- is now a release too, dated by the project's own target date.
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'ticket' NOT NULL;
