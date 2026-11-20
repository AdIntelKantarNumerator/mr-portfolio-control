-- Client Evaluation jobs (20 November 2026): the Impact Deck and the client
-- and user export take minutes, so they run in the background and keep their
-- progress and their finished file here, where any instance of the app can
-- answer "how far along is it?" and hand the file over. Old jobs are deleted
-- after a day (lib/client-eval/jobs.ts).
CREATE TABLE IF NOT EXISTS "ce_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "params" jsonb NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "step" text,
  "done" integer DEFAULT 0 NOT NULL,
  "total" integer DEFAULT 0 NOT NULL,
  "error" text,
  "file_name" text,
  "file_type" text,
  "file" bytea,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
