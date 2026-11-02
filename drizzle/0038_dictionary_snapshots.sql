-- A stored copy of a ClickHouse catalog (2 November 2026). Prod ClickHouse is
-- on a private address the web app cannot reach yet, so a laptop on the VPN
-- reads it and sends the copy here (scripts/dictionary-snapshot.ts). The
-- Data Dictionary shows it, marked static with when it was taken, while
-- CLICKHOUSE_<ENV>_SOURCE=snapshot. One row per environment; the next
-- snapshot replaces it.
CREATE TABLE IF NOT EXISTS "dictionary_snapshots" (
  "env" text PRIMARY KEY NOT NULL,
  "taken_at" timestamp with time zone NOT NULL,
  "taken_by" text,
  "catalog" text NOT NULL,
  "columns" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
