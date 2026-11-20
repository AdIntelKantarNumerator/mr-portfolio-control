-- Client Evaluation (20 November 2026): logins in the last 30 days, to sort
-- clients and people by recent use. Counted at each snapshot: 360's login
-- sessions, Classic's login history. Magnifier records none we can read.
ALTER TABLE "ce_users" ADD COLUMN IF NOT EXISTS "logins30" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ce_clients" ADD COLUMN IF NOT EXISTS "logins30" integer DEFAULT 0 NOT NULL;
