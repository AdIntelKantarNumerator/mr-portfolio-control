-- The report behind each Report Builder download link (17 November 2026).
-- The link carried the whole spec in its address, and a report imported from
-- 360 (Scott's "FinServ Top 50") outgrew the server's header limit, HTTP 431.
-- The link now carries a short key, a hash of the spec; the spec is kept here.
CREATE TABLE IF NOT EXISTS "report_builder_exports" (
  "key" text PRIMARY KEY NOT NULL,
  "spec" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
