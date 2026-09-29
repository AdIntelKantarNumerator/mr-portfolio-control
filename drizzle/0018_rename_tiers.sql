-- Rename the three tiers to line up with Linear's vocabulary.
--
--   workstream -> project      (a Linear Project is this)
--   project    -> initiative   (a Linear Initiative is this)
--   initiative -> objective    (no Linear counterpart; "Strategic Objective")
--
-- IT IS A ROTATION, NOT THREE RENAMES
--
-- Done in sequence, renaming workstreams -> projects first collides with the
-- projects table that still exists, and if the collision were somehow avoided
-- the second rename would carry the brand-new projects up to initiatives and
-- collapse two tiers into one. Every rotation below therefore parks one name
-- out of the way first. The temporary names are deliberately unusable so a
-- half-applied migration is obvious rather than plausible.
--
-- The whole file runs in one transaction, so it either lands completely or
-- not at all.

--> statement-breakpoint

-- --- tables ---------------------------------------------------------------

ALTER TABLE "workstreams" RENAME TO "tier_rotate_tmp";--> statement-breakpoint
ALTER TABLE "projects" RENAME TO "initiatives_new";--> statement-breakpoint
ALTER TABLE "initiatives" RENAME TO "objectives";--> statement-breakpoint
ALTER TABLE "initiatives_new" RENAME TO "initiatives";--> statement-breakpoint
ALTER TABLE "tier_rotate_tmp" RENAME TO "projects";--> statement-breakpoint

-- --- foreign keys and other columns named after a tier ---------------------
--
-- Each one points one tier up, so each moves up with the tier it names.

-- was projects.initiative_id, now initiatives.objective_id
ALTER TABLE "initiatives" RENAME COLUMN "initiative_id" TO "objective_id";--> statement-breakpoint
-- was workstreams.project_id, now projects.initiative_id
ALTER TABLE "projects" RENAME COLUMN "project_id" TO "initiative_id";--> statement-breakpoint

ALTER TABLE "allocations" RENAME COLUMN "project_id" TO "initiative_id";--> statement-breakpoint
ALTER TABLE "grouping_suggestions" RENAME COLUMN "project_ids" TO "initiative_ids";--> statement-breakpoint
ALTER TABLE "grouping_suggestions" RENAME COLUMN "initiative_id" TO "objective_id";--> statement-breakpoint
ALTER TABLE "intake_requests" RENAME COLUMN "proposed_initiative_id" TO "proposed_objective_id";--> statement-breakpoint
ALTER TABLE "intake_requests" RENAME COLUMN "converted_project_id" TO "converted_initiative_id";--> statement-breakpoint
ALTER TABLE "discovery_topics" RENAME COLUMN "workstream" TO "project";--> statement-breakpoint

-- project_readiness keeps its name on purpose. It holds one row per
-- workstream, so once a workstream is a project the name it already had is
-- the correct one; only its key column moves.
ALTER TABLE "project_readiness" RENAME COLUMN "workstream_id" TO "project_id";--> statement-breakpoint

-- --- the words stored as values --------------------------------------------
--
-- Seventeen columns hold a tier name as data. Same rotation, same reason for
-- doing it in one statement each: a CASE cannot see its own output, where
-- three UPDATEs in a row would rotate some rows twice.

UPDATE "dependencies" SET "from_type" = CASE "from_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "from_type" END;--> statement-breakpoint
UPDATE "dependencies" SET "to_type" = CASE "to_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "to_type" END;--> statement-breakpoint

UPDATE "assessments" SET "entity_type" = CASE "entity_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "entity_type" END;--> statement-breakpoint
UPDATE "field_overrides" SET "entity_type" = CASE "entity_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "entity_type" END;--> statement-breakpoint
UPDATE "status_updates" SET "entity_type" = CASE "entity_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "entity_type" END;--> statement-breakpoint
UPDATE "decisions" SET "entity_type" = CASE "entity_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "entity_type" END;--> statement-breakpoint
UPDATE "entity_themes" SET "entity_type" = CASE "entity_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "entity_type" END;--> statement-breakpoint
UPDATE "source_records" SET "entity_type" = CASE "entity_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "entity_type" END;--> statement-breakpoint
UPDATE "changelog_entries" SET "entity_type" = CASE "entity_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "entity_type" END;--> statement-breakpoint
UPDATE "conversation_sources" SET "entity_type" = CASE "entity_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "entity_type" END;--> statement-breakpoint
UPDATE "transcripts" SET "entity_type" = CASE "entity_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "entity_type" END;--> statement-breakpoint
UPDATE "briefs" SET "entity_type" = CASE "entity_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "entity_type" END;--> statement-breakpoint
UPDATE "agent_observations" SET "entity_type" = CASE "entity_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "entity_type" END;--> statement-breakpoint
UPDATE "date_observations" SET "entity_type" = CASE "entity_type"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "entity_type" END;--> statement-breakpoint

UPDATE "action_item_links" SET "level" = CASE "level"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "level" END;--> statement-breakpoint
UPDATE "card_orders" SET "level" = CASE "level"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "level" END;--> statement-breakpoint
UPDATE "milestones" SET "level" = CASE "level"
  WHEN 'workstream' THEN 'project' WHEN 'project' THEN 'initiative' WHEN 'initiative' THEN 'objective'
  ELSE "level" END;--> statement-breakpoint

-- The default moves with the values it produces. Left alone, every milestone
-- written from here on would be filed against a tier whose name no longer
-- exists, and nothing would notice until one failed to appear on a page.
ALTER TABLE "milestones" ALTER COLUMN "level" SET DEFAULT 'project';
--> statement-breakpoint

-- --- the labels this app ships --------------------------------------------
--
-- Readiness items and templates are reference data seeded from
-- scripts/seed-process.ts, not anything a person wrote. Their source now says
-- "project", so a database seeded before today would disagree with one seeded
-- after it — the same checklist item under two names, which is how a report
-- ends up counting it twice.
--
-- Deliberately narrow: `replace` on the exact words, on the two tables whose
-- text this app authors.
--
-- What is NOT touched, on purpose:
--   - changelog_entries, which is a record of what happened. "Centralized
--     workstream folder — Not started → Done" is what the row said on the day,
--     and editing it would be rewriting the audit trail to match today's
--     vocabulary.
--   - decisions, blockers, assessments and every other field somebody typed.
--     A decision that says "dedicate capacity to a focused GPC workstream" is
--     that person's sentence, and renaming a tier is not licence to edit it.

UPDATE "readiness_items"
   SET "label" = replace(replace("label", 'Workstream', 'Project'), 'workstream', 'project'),
       "description" = replace(replace("description", 'Workstream', 'Project'), 'workstream', 'project')
 WHERE "label" ILIKE '%workstream%' OR "description" ILIKE '%workstream%';--> statement-breakpoint

UPDATE "templates"
   SET "name" = replace(replace("name", 'Workstream', 'Project'), 'workstream', 'project'),
       "description" = replace(replace("description", 'Workstream', 'Project'), 'workstream', 'project')
 WHERE "name" ILIKE '%workstream%' OR "description" ILIKE '%workstream%';
