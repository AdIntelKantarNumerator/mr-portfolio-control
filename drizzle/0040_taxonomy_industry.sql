-- The Industry View of Taxonomy Comparison (9 November 2026): the GPC
-- taxonomy tree, and each node's top spenders, read from Databricks once and
-- kept. Aug-Sep 2026 is a fixed window, so a node read once serves everyone
-- until someone asks for it again. One row per thing read: "tree", or
-- "node:<taxonomy_node_id>". progress and result are JSON; see
-- src/lib/taxonomy-industry.ts.
CREATE TABLE IF NOT EXISTS "taxonomy_industry" (
  "key" text PRIMARY KEY NOT NULL,
  "status" text NOT NULL,
  "progress" text NOT NULL,
  "result" text,
  "error" text,
  "asked_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
