CREATE TABLE "date_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"field" text NOT NULL,
	"value" timestamp with time zone,
	"source" text DEFAULT 'linear' NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "date_observations_entity_idx" ON "date_observations" USING btree ("entity_type","entity_id","field","observed_at");