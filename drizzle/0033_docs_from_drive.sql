-- Process Documentation published through a Google Drive folder (20 October 2026).
--
-- Claude in Cowork cannot reach this site (its workspace's network allowlist
-- blocks it, and changing that needs an org admin), but it can save files to
-- Google Drive. Yaara watches a shared Drive folder and imports what lands
-- there (yaara/src/collect/docs-drop.ts).
--
--   doc_artifacts.drive_file_id   the Drive file a document came from, so a
--                                 later save of that file is a new version of
--                                 the same document even if it was renamed
--   doc_versions.source_ref       "drive:<file id>@<modified time>": one import
--                                 per saved revision, never two

ALTER TABLE "doc_artifacts" ADD COLUMN IF NOT EXISTS "drive_file_id" text;
--> statement-breakpoint
ALTER TABLE "doc_versions" ADD COLUMN IF NOT EXISTS "source_ref" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doc_versions_source_ref_uq" ON "doc_versions" USING btree ("source_ref") WHERE "source_ref" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_artifacts_drive_idx" ON "doc_artifacts" USING btree ("drive_file_id");
