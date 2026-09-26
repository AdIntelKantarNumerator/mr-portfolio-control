-- Yaara proposing which projects belong together.
--
-- A table rather than an observation, because a suggestion has a lifecycle an
-- observation does not: it is pending until a person accepts or dismisses it,
-- and accepting it *does* something — it creates an initiative and moves
-- projects into it. Filing that as a bullet on a card would mean the only
-- record of "she suggested this and we said no" is a paragraph nobody can
-- query, and she would suggest it again next week.
--
-- project_ids is a comma-separated list of ids, not jsonb, for the same reason
-- as everywhere else in this schema: the app reads it whole or not at all, and
-- a text column is one less thing that behaves differently on two Postgres
-- versions.
--
-- Nothing here cascades. A suggestion naming a project that was since deleted
-- is stale, not corrupt, and the page says so rather than vanishing.
CREATE TABLE "grouping_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rationale" text,
	"project_ids" text NOT NULL,
	"agent" text DEFAULT 'yaara' NOT NULL,
	"model" text,
	"evidence" text,
	-- pending | accepted | dismissed
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"initiative_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "grouping_suggestions_status_idx" ON "grouping_suggestions" ("status","created_at");
