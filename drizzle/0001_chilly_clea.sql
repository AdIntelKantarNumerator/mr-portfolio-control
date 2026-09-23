CREATE TABLE "discovery_topics" (
	"id" text PRIMARY KEY NOT NULL,
	"workstream" text NOT NULL,
	"question" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_gates" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"phase" text DEFAULT 'discovery' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_gates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "project_readiness" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"item_id" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"link" text,
	"note" text,
	"updated_by_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readiness_items" (
	"id" text PRIMARY KEY NOT NULL,
	"gate_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"template_url" text,
	"owner_role" text,
	"required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "readiness_items_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"kind" text DEFAULT 'doc' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "project_readiness" ADD CONSTRAINT "project_readiness_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_readiness" ADD CONSTRAINT "project_readiness_item_id_readiness_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."readiness_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_readiness" ADD CONSTRAINT "project_readiness_updated_by_id_people_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_items" ADD CONSTRAINT "readiness_items_gate_id_lifecycle_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."lifecycle_gates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_topics_workstream_idx" ON "discovery_topics" USING btree ("workstream");--> statement-breakpoint
CREATE UNIQUE INDEX "project_readiness_unique" ON "project_readiness" USING btree ("project_id","item_id");--> statement-breakpoint
CREATE INDEX "project_readiness_project_idx" ON "project_readiness" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "readiness_items_gate_idx" ON "readiness_items" USING btree ("gate_id");