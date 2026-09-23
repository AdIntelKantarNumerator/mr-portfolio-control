CREATE TABLE "briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"items" text NOT NULL,
	"model" text NOT NULL,
	"transcript_count" integer DEFAULT 0 NOT NULL,
	"covers_through" timestamp with time zone,
	"generated_by" text,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"label" text NOT NULL,
	"external_id" text,
	"url" text,
	"ingest_enabled" boolean DEFAULT false NOT NULL,
	"added_by" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_ingested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"url" text,
	"body" text NOT NULL,
	"fingerprint" text NOT NULL,
	"ingested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_source_id_conversation_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."conversation_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefs_entity_idx" ON "briefs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "conversation_sources_entity_idx" ON "conversation_sources" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_sources_external_unique" ON "conversation_sources" USING btree ("kind","external_id");--> statement-breakpoint
CREATE INDEX "transcripts_entity_idx" ON "transcripts" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transcripts_fingerprint_unique" ON "transcripts" USING btree ("fingerprint");