CREATE TABLE "agent_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"agent" text DEFAULT 'yaara' NOT NULL,
	"items" text NOT NULL,
	"evidence" text NOT NULL,
	"model" text NOT NULL,
	"served_by" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "authored_by" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "agent_observations_entity_idx" ON "agent_observations" USING btree ("entity_type","entity_id","superseded_at");--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_reviewed_by_people_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;