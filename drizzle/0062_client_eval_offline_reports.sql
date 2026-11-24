-- Client Evaluation (24 November 2026): people who receive Magnifier's offline
-- reports, by email, loaded from a laptop (scripts/load-offline-reports.ts).
-- A client with one who downloaded a report in 2026 gets the Competitive package.
CREATE TABLE IF NOT EXISTS "ce_offline_reports" (
  "email" text PRIMARY KEY NOT NULL,
  "last_download" date,
  "reports" integer DEFAULT 0 NOT NULL,
  "example" text,
  "loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
