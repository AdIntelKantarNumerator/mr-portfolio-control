CREATE TABLE "workstream_items" (
	"id" text PRIMARY KEY NOT NULL,
	"workstream_id" text NOT NULL,
	"state" text DEFAULT 'in_progress' NOT NULL,
	"text" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"authored_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workstream_phases" (
	"id" text PRIMARY KEY NOT NULL,
	"workstream_id" text NOT NULL,
	"phase" text DEFAULT 'development' NOT NULL,
	"label" text,
	"from_period" text NOT NULL,
	"to_period" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workstreams" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'planning' NOT NULL,
	"target_label" text,
	"dependencies" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"authored_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "dev_lead" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "program_lead" text;--> statement-breakpoint
ALTER TABLE "workstream_items" ADD CONSTRAINT "workstream_items_workstream_id_workstreams_id_fk" FOREIGN KEY ("workstream_id") REFERENCES "public"."workstreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstream_phases" ADD CONSTRAINT "workstream_phases_workstream_id_workstreams_id_fk" FOREIGN KEY ("workstream_id") REFERENCES "public"."workstreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstreams" ADD CONSTRAINT "workstreams_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workstream_items_workstream_idx" ON "workstream_items" USING btree ("workstream_id");--> statement-breakpoint
CREATE INDEX "workstream_phases_workstream_idx" ON "workstream_phases" USING btree ("workstream_id");--> statement-breakpoint
CREATE INDEX "workstreams_project_idx" ON "workstreams" USING btree ("project_id");