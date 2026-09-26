-- The vocabulary rotation, and the new initiative layer.
--
-- WHAT MOVES
--
--   was              becomes
--   ---------------  ------------------------------------------
--   (nothing)        initiatives   — a grouping of projects, 5–10 active
--   initiatives      projects
--   projects         workstreams   — the Linear-level unit
--   workstreams      milestones    — the program review rows
--   milestones       merged into milestones, at workstream level
--
-- WRITTEN BY HAND, DELIBERATELY. drizzle-kit sees a rename as a drop and a
-- create: it would produce a migration that silently discards every project,
-- initiative and program review row in the database. Renames keep the rows,
-- the ids and the foreign keys, which is the whole point.
--
-- THE ORDER OF THE ENTITY_TYPE REWRITE IS NOT COSMETIC
--
-- Twelve tables carry an entity_type of 'project' or 'initiative'. Rewriting
-- those in two statements — project→workstream, then initiative→project —
-- looks right and is right. Doing it the other way round converts BOTH to
-- workstream, because the second statement re-reads rows the first just
-- wrote. A single CASE is used instead so the order cannot be got wrong by
-- somebody editing this later.

--> statement-breakpoint
-- 1. The granular milestones step aside; they are merged back in at step 6.
ALTER TABLE "milestones" RENAME TO "milestones_legacy";

--> statement-breakpoint
-- 2. Program review rows become milestones. Their children come with them.
ALTER TABLE "workstreams" RENAME TO "milestones";
--> statement-breakpoint
ALTER TABLE "workstream_items" RENAME TO "milestone_items";
--> statement-breakpoint
ALTER TABLE "workstream_phases" RENAME TO "milestone_phases";
--> statement-breakpoint
ALTER TABLE "milestone_items" RENAME COLUMN "workstream_id" TO "milestone_id";
--> statement-breakpoint
ALTER TABLE "milestone_phases" RENAME COLUMN "workstream_id" TO "milestone_id";

--> statement-breakpoint
-- 3. The rotation itself. projects → workstreams must happen before
--    initiatives → projects, or the second rename collides with a live name.
ALTER TABLE "projects" RENAME TO "workstreams";
--> statement-breakpoint
ALTER TABLE "initiatives" RENAME TO "projects";
--> statement-breakpoint
ALTER TABLE "workstreams" RENAME COLUMN "initiative_id" TO "project_id";

--> statement-breakpoint
-- 4. The new top layer.
CREATE TABLE "initiatives" (
  "id" text PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active' NOT NULL,
  "owner_id" text,
  "start_date" timestamp with time zone,
  "target_date" timestamp with time zone,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- New objects deliberately avoid every name already in use. A renamed table
-- brings its indexes and constraints with it under their OLD names, so
-- "initiatives_key_unique" is now sitting on the projects table and creating
-- it again fails. Renaming all of those to match would be a dozen more
-- statements and a dozen more chances to get an order wrong; leaving them
-- stale is cosmetic.
CREATE UNIQUE INDEX "initiative_key_unique" ON "initiatives" USING btree ("key");
--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiative_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "initiative_id" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_init_fk"
  FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "projects_init_idx" ON "projects" USING btree ("initiative_id");

--> statement-breakpoint
-- 5. Milestones become level-aware. Every existing row is a workstream
--    milestone, because every program review row hung off a project, and a
--    project is now a workstream.
ALTER TABLE "milestones" RENAME COLUMN "project_id" TO "entity_id";
--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "level" text DEFAULT 'workstream' NOT NULL;
--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "target_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "actual_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "contested" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- The FK pointed at projects, which are now workstreams — correct, and now
-- wrong in shape: a milestone can hang off any of the three levels, so the
-- constraint has to go and the level column carries the meaning instead.
ALTER TABLE "milestones" DROP CONSTRAINT IF EXISTS "workstreams_project_id_projects_id_fk";
--> statement-breakpoint
CREATE INDEX "milestones_entity_idx" ON "milestones" USING btree ("level", "entity_id");

--> statement-breakpoint
-- 6. Merge the granular milestones in, mapping their status vocabulary onto
--    the deck's. 'moved' has no equivalent and becomes planning, which is
--    what a date nobody has re-committed to actually means.
INSERT INTO "milestones"
  ("id", "entity_id", "level", "name", "details", "status", "target_date", "actual_date",
   "contested", "sort_order", "created_at", "updated_at")
SELECT
  "id", "project_id", 'workstream', "name", "description",
  CASE "status"
    WHEN 'done' THEN 'complete'
    WHEN 'missed' THEN 'at_risk'
    ELSE 'planning'
  END,
  "target_date", "actual_date", "contested", "sort_order", "created_at", "updated_at"
FROM "milestones_legacy";
--> statement-breakpoint
DROP TABLE "milestones_legacy" CASCADE;

--> statement-breakpoint
-- 7. Action items, extracted from meeting notes.
CREATE TABLE "action_items" (
  "id" text PRIMARY KEY NOT NULL,
  "ref" text,
  "text" text NOT NULL,
  "owner_id" text,
  "owner_name" text,
  "due_date" timestamp with time zone,
  "status" text DEFAULT 'open' NOT NULL,
  "source_kind" text,
  "source_title" text,
  "source_url" text,
  "raised_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "authored_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_owner_id_people_id_fk"
  FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;

--> statement-breakpoint
-- One action item can be relevant to a workstream, its project and the
-- initiative above it at the same time, so the link is its own table rather
-- than a column. A row with no links at all is an action nobody could place,
-- which is a thing worth being able to list.
CREATE TABLE "action_item_links" (
  "id" text PRIMARY KEY NOT NULL,
  "action_item_id" text NOT NULL,
  "level" text NOT NULL,
  "entity_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_item_links" ADD CONSTRAINT "action_item_links_action_item_id_action_items_id_fk"
  FOREIGN KEY ("action_item_id") REFERENCES "public"."action_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "action_item_links_unique" ON "action_item_links" USING btree ("action_item_id", "level", "entity_id");
--> statement-breakpoint
CREATE INDEX "action_item_links_entity_idx" ON "action_item_links" USING btree ("level", "entity_id");

--> statement-breakpoint
-- 8. Every stored discriminator, rewritten in one pass per table.
UPDATE "agent_observations"  SET "entity_type" = CASE "entity_type" WHEN 'project' THEN 'workstream' WHEN 'initiative' THEN 'project' ELSE "entity_type" END WHERE "entity_type" IN ('project','initiative');
--> statement-breakpoint
UPDATE "assessments"         SET "entity_type" = CASE "entity_type" WHEN 'project' THEN 'workstream' WHEN 'initiative' THEN 'project' ELSE "entity_type" END WHERE "entity_type" IN ('project','initiative');
--> statement-breakpoint
UPDATE "briefs"              SET "entity_type" = CASE "entity_type" WHEN 'project' THEN 'workstream' WHEN 'initiative' THEN 'project' ELSE "entity_type" END WHERE "entity_type" IN ('project','initiative');
--> statement-breakpoint
UPDATE "changelog_entries"   SET "entity_type" = CASE "entity_type" WHEN 'project' THEN 'workstream' WHEN 'initiative' THEN 'project' ELSE "entity_type" END WHERE "entity_type" IN ('project','initiative');
--> statement-breakpoint
UPDATE "conversation_sources" SET "entity_type" = CASE "entity_type" WHEN 'project' THEN 'workstream' WHEN 'initiative' THEN 'project' ELSE "entity_type" END WHERE "entity_type" IN ('project','initiative');
--> statement-breakpoint
UPDATE "date_observations"   SET "entity_type" = CASE "entity_type" WHEN 'project' THEN 'workstream' WHEN 'initiative' THEN 'project' ELSE "entity_type" END WHERE "entity_type" IN ('project','initiative');
--> statement-breakpoint
UPDATE "decisions"           SET "entity_type" = CASE "entity_type" WHEN 'project' THEN 'workstream' WHEN 'initiative' THEN 'project' ELSE "entity_type" END WHERE "entity_type" IN ('project','initiative');
--> statement-breakpoint
UPDATE "entity_themes"       SET "entity_type" = CASE "entity_type" WHEN 'project' THEN 'workstream' WHEN 'initiative' THEN 'project' ELSE "entity_type" END WHERE "entity_type" IN ('project','initiative');
--> statement-breakpoint
UPDATE "field_overrides"     SET "entity_type" = CASE "entity_type" WHEN 'project' THEN 'workstream' WHEN 'initiative' THEN 'project' ELSE "entity_type" END WHERE "entity_type" IN ('project','initiative');
--> statement-breakpoint
UPDATE "source_records"      SET "entity_type" = CASE "entity_type" WHEN 'project' THEN 'workstream' WHEN 'initiative' THEN 'project' ELSE "entity_type" END WHERE "entity_type" IN ('project','initiative');
--> statement-breakpoint
UPDATE "status_updates"      SET "entity_type" = CASE "entity_type" WHEN 'project' THEN 'workstream' WHEN 'initiative' THEN 'project' ELSE "entity_type" END WHERE "entity_type" IN ('project','initiative');
--> statement-breakpoint
UPDATE "transcripts"         SET "entity_type" = CASE "entity_type" WHEN 'project' THEN 'workstream' WHEN 'initiative' THEN 'project' ELSE "entity_type" END WHERE "entity_type" IN ('project','initiative');

--> statement-breakpoint
-- 9. The one-sentence assessment on the home page, and who it belongs to.
--
-- Stored on the observation rather than derived from its bullets, because a
-- person can edit it: the moment somebody rewrites Yaara's sentence it stops
-- being a summary of her bullets and becomes their statement, and the card has
-- to say so. verdict_by carries whoever last wrote it — her, or a name.
ALTER TABLE "agent_observations" ADD COLUMN "verdict" text;
--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "verdict_by" text;
--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "verdict_at" timestamp with time zone;
