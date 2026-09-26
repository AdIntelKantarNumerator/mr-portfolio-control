-- Two columns the hierarchy rotation missed.
--
-- 0011 rotated the tables and the twelve entity_type columns, and it renamed
-- every foreign key that was spelled with the word it was rotating. These two
-- were spelled with the OTHER word, which is exactly why they were missed:
--
--   allocations.initiative_id      a team allocated to an old initiative,
--                                  which is now a project
--   project_readiness.project_id   a readiness gate on an old project,
--                                  which is now a workstream
--
-- Both are half-renames until this runs: src/db/schema.ts already selects the
-- new names, so /projects and /workstreams answer 500 with "column does not
-- exist" and nothing else in the app notices. scripts/check-schema-drift.ts
-- is the check that found them and is the check that keeps finding this class.
--
-- Constraints and indexes carry the old column name in their own names. They
-- are renamed too, so the next person reading \d allocations is not told this
-- table points at initiatives.

ALTER TABLE "allocations" RENAME COLUMN "initiative_id" TO "project_id";--> statement-breakpoint
ALTER TABLE "project_readiness" RENAME COLUMN "project_id" TO "workstream_id";--> statement-breakpoint

-- Index and constraint names. Renaming a column does not rename the objects
-- built on it, and a unique index called allocations_unique is fine while one
-- called allocations_team_id_initiative_id_key would be a lie.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass::text AS tbl
      FROM pg_constraint
     WHERE conrelid IN ('allocations'::regclass, 'project_readiness'::regclass)
       AND (conname LIKE '%initiative_id%' OR conname LIKE '%project_id%')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
      r.tbl,
      r.conname,
      CASE
        WHEN r.tbl = 'allocations' THEN replace(r.conname, 'initiative_id', 'project_id')
        ELSE replace(r.conname, 'project_id', 'workstream_id')
      END
    );
  END LOOP;

  FOR r IN
    SELECT indexname, tablename AS tbl
      FROM pg_indexes
     WHERE tablename IN ('allocations', 'project_readiness')
       AND (indexname LIKE '%initiative_id%' OR indexname LIKE '%project_id%')
  LOOP
    EXECUTE format(
      'ALTER INDEX %I RENAME TO %I',
      r.indexname,
      CASE
        WHEN r.tbl = 'allocations' THEN replace(r.indexname, 'initiative_id', 'project_id')
        ELSE replace(r.indexname, 'project_id', 'workstream_id')
      END
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- Constraint and index names left behind by the rotation.
--
-- Renaming a table does not rename the objects on it, so inserting a duplicate
-- project reports a violation of "initiatives_pkey" on table "projects", and
-- the foreign key from workstreams to projects is still called
-- projects_initiative_id_initiatives_id_fk. Every one of those names is now a
-- sentence that is false, and they surface in exactly the situation where
-- somebody is already confused: reading an error at 2am.
--
-- WHY THIS IS DONE IN TWO PASSES
--
-- The rotation is a cycle, so the names are too: the index that should become
-- projects_key_unique cannot, because workstreams (the old projects table)
-- still holds that name. Renaming straight to the final names fails on
-- whichever one happens to go first. Everything is therefore parked under a
-- temporary name first and given its real one second — the same reason the
-- entity_type rewrite in 0011 is a single CASE rather than two UPDATEs.
DO $$
DECLARE
  r record;
  fresh text;
  n int := 0;
BEGIN
  CREATE TEMP TABLE rot_names (tbl text, parked text, final text, kind text) ON COMMIT DROP;

  FOR r IN
    SELECT c.conname AS nm, t.relname AS tbl, 'constraint' AS kind
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = t.relnamespace AND ns.nspname = 'public'
     WHERE t.relname IN ('projects', 'workstreams', 'milestones', 'milestone_items', 'milestone_phases')
    UNION ALL
    SELECT i.indexname, i.tablename, 'index'
      FROM pg_indexes i
     WHERE i.schemaname = 'public'
       AND i.tablename IN ('projects', 'workstreams', 'milestones', 'milestone_items', 'milestone_phases')
       -- An index that backs a constraint is renamed with the constraint.
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = i.indexname)
  LOOP
    fresh := r.nm;
    -- Longest prefixes first: workstream_items_ must not be seen as workstreams_.
    IF r.tbl = 'milestone_items' THEN fresh := regexp_replace(fresh, '^workstream_items_', 'milestone_items_');
    ELSIF r.tbl = 'milestone_phases' THEN fresh := regexp_replace(fresh, '^workstream_phases_', 'milestone_phases_');
    ELSIF r.tbl = 'milestones' THEN fresh := regexp_replace(fresh, '^workstreams_', 'milestones_');
    ELSIF r.tbl = 'workstreams' THEN fresh := regexp_replace(fresh, '^projects_', 'workstreams_');
    ELSIF r.tbl = 'projects' THEN fresh := regexp_replace(fresh, '^initiatives_', 'projects_');
    END IF;
    -- The column inside the name rotated too.
    fresh := replace(fresh, '_workstream_id_workstreams_id_fk', '_milestone_id_milestones_id_fk');
    fresh := replace(fresh, '_initiative_id_initiatives_id_fk', '_project_id_projects_id_fk');
    CONTINUE WHEN fresh = r.nm;

    n := n + 1;
    INSERT INTO rot_names VALUES (r.tbl, 'rot_parked_' || n, fresh, r.kind);
    IF r.kind = 'constraint' THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.nm, 'rot_parked_' || n);
    ELSE
      EXECUTE format('ALTER INDEX %I RENAME TO %I', r.nm, 'rot_parked_' || n);
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM rot_names LOOP
    IF r.kind = 'constraint' THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.parked, r.final);
    ELSE
      EXECUTE format('ALTER INDEX %I RENAME TO %I', r.parked, r.final);
    END IF;
  END LOOP;

  DROP TABLE rot_names;
END $$;
