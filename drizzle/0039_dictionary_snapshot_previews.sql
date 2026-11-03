-- Sample rows in the Data Dictionary's stored copy (3 November 2026). Scott:
-- the tables hold no personal data and anyone may see them, and stale is fine,
-- so a snapshot keeps the first rows of each table as well as its structure.
-- JSON: { "<db.table>": { columns, rows } | { error } }; see
-- src/lib/dictionary-snapshot.ts.
ALTER TABLE "dictionary_snapshots" ADD COLUMN IF NOT EXISTS "previews" text;
