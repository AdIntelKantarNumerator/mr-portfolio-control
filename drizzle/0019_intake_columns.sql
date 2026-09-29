-- Name the two intake columns after what they actually hold.
--
-- Both were already a tier above their own foreign key before the rename, and
-- 0018 moved them faithfully, so they are now two tiers out:
--
--   proposed_objective_id   REFERENCES initiatives(id)
--   converted_initiative_id REFERENCES projects(id)
--
-- The foreign key is the evidence, not an inference: whatever the column is
-- called, Postgres will only let it hold an id from the table it points at.
-- The screen has always been right — the form offers initiatives and says
-- "Proposed initiative", and conversion inserts a project and says "Became a
-- project" — so this is the schema catching up with the product rather than a
-- behaviour change. Nothing reads or writes a different row afterwards.
--
-- Net effect against the database as it stood before 0018: these two columns
-- end up with the names they started with. That is not a mistake in 0018; it
-- is what happens when you rotate a name that was already off by one.

ALTER TABLE "intake_requests" RENAME COLUMN "proposed_objective_id" TO "proposed_initiative_id";--> statement-breakpoint
ALTER TABLE "intake_requests" RENAME COLUMN "converted_initiative_id" TO "converted_project_id";
