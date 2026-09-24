CREATE TABLE "decision_events" (
	"id" text PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"meeting" text,
	"document_id" text,
	"url" text,
	"actor" text,
	"note" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_themes" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"theme" text NOT NULL,
	"summary" text NOT NULL,
	"mentions" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_meeting" text,
	"last_document_id" text,
	"authored_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" text DEFAULT 'google_drive' NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"occurred_at" timestamp with time zone,
	"revision" text,
	"read_at" timestamp with time zone,
	"read_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "kind" text DEFAULT 'decision' NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "raised_by_id" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "raised_by_text" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "raised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "raised_at_meeting" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "raised_document_id" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "resolved_at_meeting" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "resolved_document_id" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "history" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "authored_by" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "decision_events" ADD CONSTRAINT "decision_events_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_events" ADD CONSTRAINT "decision_events_document_id_source_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_themes" ADD CONSTRAINT "entity_themes_last_document_id_source_documents_id_fk" FOREIGN KEY ("last_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_events_decision_idx" ON "decision_events" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "entity_themes_entity_idx" ON "entity_themes" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_themes_unique" ON "entity_themes" USING btree ("entity_type","entity_id","theme");--> statement-breakpoint
CREATE UNIQUE INDEX "source_documents_external_unique" ON "source_documents" USING btree ("origin","external_id");--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_raised_by_id_people_id_fk" FOREIGN KEY ("raised_by_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_reviewed_by_people_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_kind_idx" ON "decisions" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "decisions_entity_idx" ON "decisions" USING btree ("entity_type","entity_id");