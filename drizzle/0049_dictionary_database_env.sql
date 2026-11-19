-- A database's status per environment (19 November 2026). Prod's GPC
-- databases share names with Dev's legacy ones (creative, detail, summary,
-- reference, control): on Dev those are being eliminated, on Prod they are the
-- contract, and one status per name cannot say both. Every existing row was
-- written about Dev, so it stays Dev's; Prod's rows are added by the seed.
ALTER TABLE "dictionary_databases" ADD COLUMN IF NOT EXISTS "env" text DEFAULT 'dev' NOT NULL;
--> statement-breakpoint
ALTER TABLE "dictionary_databases" DROP CONSTRAINT IF EXISTS "dictionary_databases_pkey";
--> statement-breakpoint
ALTER TABLE "dictionary_databases" DROP CONSTRAINT IF EXISTS "dictionary_databases_pk";
--> statement-breakpoint
ALTER TABLE "dictionary_databases" ADD CONSTRAINT "dictionary_databases_pk" PRIMARY KEY ("env", "name");
