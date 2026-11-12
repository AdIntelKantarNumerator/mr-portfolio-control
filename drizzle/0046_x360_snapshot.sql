-- 360 Explore reports, for Report Builder's import (12 November 2026). Scott
-- wants a 360 custom report brought into Report Builder as a GPC report. The
-- 360 SQL Server is on a private network the app cannot reach, so
-- `npm run load:360`, run from a machine that can, copies the reports used in
-- 2026, who owns them, and the names they refer to; re-running it adds new
-- reports and refreshes changed ones.
CREATE TABLE IF NOT EXISTS "x360_users" (
  "usr_id" integer PRIMARY KEY NOT NULL,
  "usr_n" text NOT NULL,
  "usrset_id" integer NOT NULL,
  "usrset_n" text NOT NULL,
  "mnemonic" text NOT NULL,
  "licensegrp_id" integer,
  "licensegrp_n" text,
  "loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "x360_users_usrset_idx" ON "x360_users" ("usrset_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "x360_reports" (
  "report_key" text PRIMARY KEY NOT NULL,
  "mnemonic" text NOT NULL,
  "reportset_id" integer NOT NULL,
  "usr_id" integer NOT NULL,
  "usrset_id" integer NOT NULL,
  "name" text NOT NULL,
  "rpttype_id" integer,
  "last_used" timestamp with time zone,
  "version" text NOT NULL,
  "spec" jsonb NOT NULL,
  "loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "x360_reports_usr_idx" ON "x360_reports" ("usr_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "x360_names" (
  "name_key" text PRIMARY KEY NOT NULL,
  "entmaj_id" integer NOT NULL,
  "master_id" bigint NOT NULL,
  "name" text NOT NULL
);
