-- Two new Reference screens: Workflow Assessment and Data Dictionary.
--
-- WORKFLOW ASSESSMENT
--
-- A map of the company's major software components and the human workflows
-- around them, with arrows for what feeds what. The point of it is the
-- question "if I change this, what else moves", so the arrows carry the
-- meaning and the boxes carry a description people can match a request
-- against.
--
-- Nothing about layout is stored. Which column a box sits in is computed from
-- the arrows every time the page renders, because a stored position is wrong
-- the first time somebody adds a connection.
--
-- DATA DICTIONARY
--
-- What people know about the ClickHouse client-consumable model. The structure
-- itself — engines, columns, types, row counts — is read live from ClickHouse
-- and never copied here: a copy is wrong the next time a loader runs. These
-- tables hold only what a person has to supply: what a thing means, whether it
-- is meant to be loaded, and what will produce a wrong number.
--
-- Tables and columns are referred to by "database.table" text, not by foreign
-- key. They live in another system, and a note about a table that was dropped
-- is worth keeping and showing as drift rather than cascading away.
--
-- The rows themselves are seeded by `npm run seed:reference`, which only fills
-- tables that are empty, so it is safe to run after every deploy.

CREATE TABLE IF NOT EXISTS "workflow_groups" (
  "key" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  -- software | human
  "kind" text DEFAULT 'software' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow_components" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  -- software | human | rule
  "kind" text DEFAULT 'software' NOT NULL,
  "group_key" text NOT NULL,
  "owner" text,
  "description" text,
  "detail" text,
  "aliases" text,
  "is_data" boolean DEFAULT false NOT NULL,
  "created_by" text,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- ON UPDATE cascade so a group's key can be corrected without orphaning the
-- boxes in it. No ON DELETE: deleting a group that still has components in it
-- is refused, which is the right answer to "where did those boxes go".
ALTER TABLE "workflow_components" ADD CONSTRAINT "workflow_components_group_fk"
  FOREIGN KEY ("group_key") REFERENCES "public"."workflow_groups"("key") ON DELETE no action ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_components_group_idx" ON "workflow_components" USING btree ("group_key");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow_links" (
  "id" text PRIMARY KEY NOT NULL,
  "from_id" text NOT NULL,
  "to_id" text NOT NULL,
  "note" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A link is meaningless without both ends, so deleting a component takes its
-- arrows with it.
ALTER TABLE "workflow_links" ADD CONSTRAINT "workflow_links_from_fk"
  FOREIGN KEY ("from_id") REFERENCES "public"."workflow_components"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_links" ADD CONSTRAINT "workflow_links_to_fk"
  FOREIGN KEY ("to_id") REFERENCES "public"."workflow_components"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_links_pair_unique" ON "workflow_links" USING btree ("from_id", "to_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "dictionary_datasets" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "owner" text,
  "description" text,
  -- loaded | awaiting_feed | by_design | planned | undecided
  "intent_dev" text DEFAULT 'undecided' NOT NULL,
  "intent_prod" text DEFAULT 'undecided' NOT NULL,
  "explained_by" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "dictionary_dataset_tables" (
  "dataset_id" text NOT NULL,
  -- "database.table"
  "table_ref" text NOT NULL,
  CONSTRAINT "dictionary_dataset_tables_pk" PRIMARY KEY ("dataset_id", "table_ref")
);
--> statement-breakpoint
ALTER TABLE "dictionary_dataset_tables" ADD CONSTRAINT "dictionary_dataset_tables_dataset_fk"
  FOREIGN KEY ("dataset_id") REFERENCES "public"."dictionary_datasets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "dictionary_databases" (
  "name" text PRIMARY KEY NOT NULL,
  -- contract | internal | transition | superseded | excluded | unreviewed
  "status" text DEFAULT 'unreviewed' NOT NULL,
  "description" text,
  "updated_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "dictionary_tables" (
  "table_ref" text PRIMARY KEY NOT NULL,
  "description" text,
  "owner" text,
  "watch_out" text,
  -- by_design | awaiting_feed | undecided — why an empty table is empty
  "empty_reason" text,
  "excluded" boolean DEFAULT false NOT NULL,
  "updated_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "dictionary_columns" (
  "table_ref" text NOT NULL,
  "column_name" text NOT NULL,
  "description" text,
  "meaning" text,
  "watch_out" text,
  "source" text,
  -- set while a machine draft is untouched by a person; cleared on first human save
  "drafted_by" text,
  "updated_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dictionary_columns_pk" PRIMARY KEY ("table_ref", "column_name")
);
