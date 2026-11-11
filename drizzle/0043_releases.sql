-- The Release Calendar (11 November 2026): planned Production releases, read by
-- Yaara each pass from Linear tickets labelled "Production Release" (or
-- "Production Deployment", the label in use) and kept here. One row per Linear
-- ticket. announced_key is the target date she last announced in
-- #mr-production-deployments ("none" for no date), so a new release or a moved
-- date is announced once, and a failed post is tried again next pass.
-- removed_at: no longer labelled, or gone; hidden, kept for the record.
-- See src/lib/releases.ts.
CREATE TABLE IF NOT EXISTS "releases" (
  "linear_id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "url" text,
  "target_date" text,
  "status" text,
  "status_type" text,
  "created_by" text,
  "assignee" text,
  "project_linear_id" text,
  "project_name" text,
  "project_lead" text,
  "teams_impacted" text NOT NULL DEFAULT '[]',
  "contact_name" text,
  "contact_slack_url" text,
  "announced_key" text,
  "announced_at" timestamp with time zone,
  "removed_at" timestamp with time zone,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "releases_identifier_idx" ON "releases" ("identifier");
