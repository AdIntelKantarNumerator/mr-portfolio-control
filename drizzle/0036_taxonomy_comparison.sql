-- Taxonomy Comparison (29 October 2026): the Classic snapshot and the runs.
-- See src/db/schema.ts.
CREATE TABLE IF NOT EXISTS "classic_spend" (
	"advertiser_id" integer NOT NULL,
	"advertiser_name" text NOT NULL,
	"media_type" text NOT NULL,
	"month" text NOT NULL,
	"spend" double precision NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classic_spend_advertiser_id_media_type_month_pk" PRIMARY KEY("advertiser_id","media_type","month")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "classic_names" (
	"name" text NOT NULL,
	"advertiser_id" integer NOT NULL,
	"level" text NOT NULL,
	CONSTRAINT "classic_names_name_advertiser_id_pk" PRIMARY KEY("name","advertiser_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "taxonomy_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"input" text NOT NULL,
	"asked_by" text,
	"status" text NOT NULL,
	"progress" text NOT NULL,
	"result" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "taxonomy_runs_created_idx" ON "taxonomy_runs" USING btree ("created_at");
