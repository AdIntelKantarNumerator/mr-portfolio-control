-- Client Evaluation job files in pieces (20 November 2026). The export is
-- about 60 MB; writing and reading it as one value held the whole file (and
-- its hex encoding) in the app's memory at once, on a 1.75 GB B1 plan. Pieces
-- of 2 MB are written as they come and streamed back on download.
CREATE TABLE IF NOT EXISTS "ce_job_chunks" (
  "job_id" text NOT NULL,
  "seq" integer NOT NULL,
  "data" bytea NOT NULL,
  CONSTRAINT "ce_job_chunks_pk" PRIMARY KEY ("job_id", "seq")
);
