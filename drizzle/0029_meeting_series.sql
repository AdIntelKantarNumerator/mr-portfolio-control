-- Meeting series (8 October 2026).
--
-- A recurring set of meetings tracked together - "Working Sessions: Insights
-- Studio with GPC" plus the scrum of scrums and the running doc that feed it -
-- so the items they produce can be followed from one session to the next:
-- what was resolved since, what changed shape, what nobody has mentioned, and
-- what to check at the next one.
--
--   meeting_series            name, open or closed
--   meeting_series_meetings   the meeting names that belong to it, without
--                             their date ("Keystone SoS", not "Keystone SoS -
--                             2026/10/08 10:30 EDT"), so every session matches
--   meeting_series_checks     a written "next check" line for one item, by
--                             Yaara or a person; absent means the page derives one

CREATE TABLE IF NOT EXISTS "meeting_series" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "created_by" text,
  "closed_by" text,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_series_meetings" (
  "id" text PRIMARY KEY NOT NULL,
  "series_id" text NOT NULL REFERENCES "meeting_series"("id") ON DELETE CASCADE,
  "meeting" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_series_meetings_uq" ON "meeting_series_meetings" USING btree ("series_id", "meeting");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_series_checks" (
  "id" text PRIMARY KEY NOT NULL,
  "series_id" text NOT NULL REFERENCES "meeting_series"("id") ON DELETE CASCADE,
  "ref" text NOT NULL,
  "text" text NOT NULL,
  "written_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_series_checks_uq" ON "meeting_series_checks" USING btree ("series_id", "ref");
--> statement-breakpoint
-- The first series, the one the feature was built for.
INSERT INTO "meeting_series" ("id", "name", "created_by")
SELECT 'series-is-gpc', 'IS with GPC working sessions', 'Scott Bernberg'
WHERE NOT EXISTS (SELECT 1 FROM "meeting_series" WHERE "id" = 'series-is-gpc');
--> statement-breakpoint
INSERT INTO "meeting_series_meetings" ("id", "series_id", "meeting")
SELECT gen_random_uuid()::text, 'series-is-gpc', m
FROM (VALUES ('Working Sessions: Insights Studio with GPC'), ('Keystone SoS'), ('Insights Studio with GPC/GEC')) AS v(m)
WHERE EXISTS (SELECT 1 FROM "meeting_series" WHERE "id" = 'series-is-gpc')
ON CONFLICT DO NOTHING;
