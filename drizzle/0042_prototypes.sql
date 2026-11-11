-- Prototypes (11 November 2026): a left-nav section for work in trial, shown
-- only to people an admin ticks "Sees prototypes" for, and the first one,
-- Report Builder, which keeps each person's saved reports and each chat's
-- report-in-progress here.
ALTER TABLE "site_users" ADD COLUMN IF NOT EXISTS "can_see_prototypes" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_builder_users" (
  "email" text PRIMARY KEY NOT NULL,
  "state" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_builder_chats" (
  "chat_id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "state" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
