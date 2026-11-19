-- Client Evaluation (19 November 2026): Reference > Client Evaluation, for
-- client migrations. Scott wants every client across 360, MediaRadar Classic
-- and Magnifier on one list, with users, 2026 reports and each platform's own
-- entitlements, shown only to people an admin ticks "Sees Client Evaluation" for.
--
-- Each platform is copied into a snapshot (ce_accounts, ce_users, ce_reports),
-- refreshed per platform: 360 and Magnifier from the app, Classic from a laptop
-- (its SQL Server does not let the app in). ce_clients is the consolidated list
-- built from the snapshots; ce_overrides are the merges and splits people make
-- by hand, which survive a refresh; ce_judgments remembers what the model said
-- about a pair of accounts, so a refresh does not ask again.
ALTER TABLE "site_users" ADD COLUMN IF NOT EXISTS "can_see_client_evaluation" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ce_sources" (
  "platform" text PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'empty' NOT NULL,
  "step" text,
  "done" integer DEFAULT 0 NOT NULL,
  "total" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone,
  "loaded_at" timestamp with time zone,
  "loaded_by" text,
  "error" text,
  "counts" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ce_accounts" (
  "platform" text NOT NULL,
  "account_id" text NOT NULL,
  "name" text NOT NULL,
  "company" text,
  "active" boolean NOT NULL,
  "users" integer DEFAULT 0 NOT NULL,
  "active_users" integer DEFAULT 0 NOT NULL,
  "reports" integer DEFAULT 0 NOT NULL,
  "domains" jsonb NOT NULL,
  "summary" text,
  "entitlements" jsonb NOT NULL,
  "info" jsonb NOT NULL,
  CONSTRAINT "ce_accounts_pk" PRIMARY KEY ("platform", "account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ce_users" (
  "platform" text NOT NULL,
  "account_id" text NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "login" text,
  "email" text,
  "active" boolean NOT NULL,
  "last_seen" text,
  "reports" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "ce_users_pk" PRIMARY KEY ("platform", "account_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ce_users_email_idx" ON "ce_users" ("email");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ce_reports" (
  "platform" text NOT NULL,
  "report_id" text NOT NULL,
  "account_id" text NOT NULL,
  "name" text NOT NULL,
  "kind" text,
  "detail" jsonb NOT NULL,
  CONSTRAINT "ce_reports_pk" PRIMARY KEY ("platform", "account_id", "report_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ce_clients" (
  "client_id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "members" jsonb NOT NULL,
  "platforms" jsonb NOT NULL,
  "users" integer DEFAULT 0 NOT NULL,
  "active_users" integer DEFAULT 0 NOT NULL,
  "reports" integer DEFAULT 0 NOT NULL,
  "active" boolean NOT NULL,
  "internal" boolean DEFAULT false NOT NULL,
  "company" text,
  "how" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ce_overrides" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "member" text NOT NULL,
  "with_member" text,
  "by" text,
  "at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ce_judgments" (
  "pair" text PRIMARY KEY NOT NULL,
  "same" boolean NOT NULL,
  "why" text,
  "at" timestamp with time zone DEFAULT now() NOT NULL
);
