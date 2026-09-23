CREATE TABLE "allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"initiative_id" text NOT NULL,
	"mode" text DEFAULT 'primary' NOT NULL,
	"note" text,
	"share" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_areas" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"owner" text,
	"devs" text,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_areas_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"rag" text NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"rationale" text NOT NULL,
	"evidence" text,
	"as_of" timestamp with time zone DEFAULT now() NOT NULL,
	"assessor_id" text,
	"current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "changelog_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text DEFAULT 'system' NOT NULL,
	"kind" text DEFAULT 'change' NOT NULL,
	"summary" text NOT NULL,
	"detail" text,
	"entity_type" text,
	"entity_id" text
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"category" text DEFAULT 'delivery' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"contested" boolean DEFAULT false NOT NULL,
	"owner_id" text,
	"owner_text" text,
	"due_by" text,
	"next_action" text,
	"evidence" text,
	"lead_visible" boolean DEFAULT true NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "dependencies" (
	"id" text PRIMARY KEY NOT NULL,
	"from_type" text NOT NULL,
	"from_id" text NOT NULL,
	"to_type" text NOT NULL,
	"to_id" text NOT NULL,
	"from_label" text,
	"to_label" text,
	"kind" text DEFAULT 'blocks' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"criticality" text DEFAULT 'normal' NOT NULL,
	"description" text,
	"due_date" timestamp with time zone,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"author_id" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "initiatives" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"start_date" timestamp with time zone,
	"target_date" timestamp with time zone,
	"source_health" text,
	"owner_id" text,
	"sponsor_id" text,
	"theme_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"owner_gap" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initiatives_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "intake_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"problem" text NOT NULL,
	"outcome" text,
	"requester_name" text NOT NULL,
	"requester_email" text,
	"sponsor" text,
	"stakeholders" text,
	"theme_id" text,
	"app_area_id" text,
	"proposed_initiative_id" text,
	"desired_date" timestamp with time zone,
	"hard_date" boolean DEFAULT false NOT NULL,
	"hard_date_reason" text,
	"tshirt" text,
	"business_case" text,
	"status" text DEFAULT 'new' NOT NULL,
	"decision_note" text,
	"converted_project_id" text,
	"source" text DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_requests_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"target_date" timestamp with time zone,
	"actual_date" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"contested" boolean DEFAULT false NOT NULL,
	"portfolio_level" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"role" text,
	"team_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"bottleneck" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'backlog' NOT NULL,
	"priority" text,
	"progress" double precision DEFAULT 0 NOT NULL,
	"start_date" timestamp with time zone,
	"target_date" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"source_health" text,
	"initiative_id" text,
	"app_area_id" text,
	"lead_id" text,
	"team_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"criterion_id" text NOT NULL,
	"request_id" text NOT NULL,
	"value" double precision NOT NULL,
	"note" text,
	"scorer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_criteria" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"weight" double precision DEFAULT 1 NOT NULL,
	"direction" text DEFAULT 'benefit' NOT NULL,
	"scale_min" double precision DEFAULT 1 NOT NULL,
	"scale_max" double precision DEFAULT 5 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_models" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT false NOT NULL,
	"capacity_units" double precision,
	"capacity_label" text DEFAULT 'engineer-weeks',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scoring_models_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" text PRIMARY KEY NOT NULL,
	"system" text NOT NULL,
	"external_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"url" text,
	"raw" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"body" text NOT NULL,
	"rag" text,
	"week_of" timestamp with time zone,
	"author_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"system" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" text,
	"error" text,
	"cursor" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'delivery' NOT NULL,
	"notes" text,
	"headcount" double precision,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "themes_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_assessor_id_people_id_fk" FOREIGN KEY ("assessor_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_overrides" ADD CONSTRAINT "field_overrides_author_id_people_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_sponsor_id_people_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_requests" ADD CONSTRAINT "intake_requests_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_requests" ADD CONSTRAINT "intake_requests_app_area_id_app_areas_id_fk" FOREIGN KEY ("app_area_id") REFERENCES "public"."app_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_requests" ADD CONSTRAINT "intake_requests_proposed_initiative_id_initiatives_id_fk" FOREIGN KEY ("proposed_initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_requests" ADD CONSTRAINT "intake_requests_converted_project_id_projects_id_fk" FOREIGN KEY ("converted_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_app_area_id_app_areas_id_fk" FOREIGN KEY ("app_area_id") REFERENCES "public"."app_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_id_people_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_model_id_scoring_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."scoring_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_criterion_id_scoring_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."scoring_criteria"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_request_id_intake_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."intake_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_scorer_id_people_id_fk" FOREIGN KEY ("scorer_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_criteria" ADD CONSTRAINT "scoring_criteria_model_id_scoring_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."scoring_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_updates" ADD CONSTRAINT "status_updates_author_id_people_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_unique" ON "allocations" USING btree ("team_id","initiative_id");--> statement-breakpoint
CREATE INDEX "assessments_entity_idx" ON "assessments" USING btree ("entity_type","entity_id","current");--> statement-breakpoint
CREATE INDEX "changelog_at_idx" ON "changelog_entries" USING btree ("at");--> statement-breakpoint
CREATE INDEX "decisions_status_idx" ON "decisions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dependencies_from_idx" ON "dependencies" USING btree ("from_type","from_id");--> statement-breakpoint
CREATE INDEX "dependencies_to_idx" ON "dependencies" USING btree ("to_type","to_id");--> statement-breakpoint
CREATE INDEX "dependencies_status_idx" ON "dependencies" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "field_overrides_unique" ON "field_overrides" USING btree ("entity_type","entity_id","field");--> statement-breakpoint
CREATE INDEX "field_overrides_entity_idx" ON "field_overrides" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "initiatives_theme_idx" ON "initiatives" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX "initiatives_owner_idx" ON "initiatives" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "intake_status_idx" ON "intake_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "milestones_project_idx" ON "milestones" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "milestones_target_idx" ON "milestones" USING btree ("target_date");--> statement-breakpoint
CREATE INDEX "people_team_idx" ON "people" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "projects_initiative_idx" ON "projects" USING btree ("initiative_id");--> statement-breakpoint
CREATE INDEX "projects_app_area_idx" ON "projects" USING btree ("app_area_id");--> statement-breakpoint
CREATE INDEX "projects_lead_idx" ON "projects" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "projects_team_idx" ON "projects" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scores_unique" ON "scores" USING btree ("criterion_id","request_id","scorer_id");--> statement-breakpoint
CREATE INDEX "scores_request_idx" ON "scores" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scoring_criteria_unique" ON "scoring_criteria" USING btree ("model_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "source_records_unique" ON "source_records" USING btree ("system","external_id");--> statement-breakpoint
CREATE INDEX "source_records_entity_idx" ON "source_records" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "status_updates_entity_idx" ON "status_updates" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "sync_runs_system_idx" ON "sync_runs" USING btree ("system","started_at");