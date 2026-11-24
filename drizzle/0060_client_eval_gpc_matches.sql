-- Client Evaluation (24 November 2026): legacy advertisers, categories and names
-- already matched to Insights Studio, kept so the next Migration Plan does not
-- follow them through Databricks again. A miss is kept too (gpc NULL), so an
-- advertiser with no spend is not followed in every plan; entries are reused
-- for a week.
CREATE TABLE IF NOT EXISTS "ce_gpc_matches" (
  "kind" text NOT NULL,
  "legacy_id" text NOT NULL,
  "gpc" jsonb,
  "checked_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ce_gpc_matches_pk" PRIMARY KEY ("kind", "legacy_id")
);
