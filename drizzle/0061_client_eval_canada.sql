-- Client Evaluation (24 November 2026): a client whose accounts are all Canadian.
-- Canada is left out of the analysis unless someone asks for it ("Exclude Canada").
ALTER TABLE "ce_clients" ADD COLUMN IF NOT EXISTS "canada" boolean DEFAULT false NOT NULL;
