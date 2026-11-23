-- Client Evaluation (23 November 2026): Magnifier saved searches saved or
-- updated in 2026, from Magnifier's MongoDB, per client. Per user they are kept
-- in ce_users.reports, which for 360 holds the reports used in 2026.
ALTER TABLE "ce_clients" ADD COLUMN IF NOT EXISTS "mag_searches" integer DEFAULT 0 NOT NULL;
