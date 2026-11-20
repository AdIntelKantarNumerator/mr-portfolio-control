-- Report Builder V2: scheduled reports (20 November 2026). A saved report run
-- on a cadence and emailed as an attachment. The report is read by id at each
-- run, so edits to it (and a rolling period) apply to the next delivery.
CREATE TABLE IF NOT EXISTS "report_builder_schedules" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "report_id" text NOT NULL,
  "report_name" text NOT NULL,
  "cadence" text NOT NULL,
  "start_at" timestamp with time zone NOT NULL,
  "time_of_day" text NOT NULL,
  "timezone" text NOT NULL,
  "day_of_week" integer,
  "day_of_month" integer,
  "period" jsonb,
  "format" text NOT NULL,
  "recipients" jsonb NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "next_run_at" timestamp with time zone,
  "last_run_at" timestamp with time zone,
  "last_status" text,
  "last_error" text,
  "runs" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_builder_schedules_due" ON "report_builder_schedules" ("active", "next_run_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_builder_schedules_email" ON "report_builder_schedules" ("email");
