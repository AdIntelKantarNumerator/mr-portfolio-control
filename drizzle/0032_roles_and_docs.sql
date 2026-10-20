-- Roles, an Admin section, and Process Documentation (20 October 2026).
--
-- site_users        who may see what. Keyed by sign-in email. role is
--                   'product' (everything, for now) or 'commercial' (the
--                   Reference section only). Anyone with no row is treated as
--                   commercial. Admins see the Admin section, can change
--                   anyone's access, and always may edit documentation.
-- doc_folders       Process Documentation folders; parent_id null is the top.
-- doc_artifacts     a published Claude artifact inside a folder.
-- doc_versions      every upload of an artifact; the newest is what is shown.
-- doc_upload_tokens a person's token for publishing straight from Claude.
--                   Only a hash is stored.

CREATE TABLE IF NOT EXISTS "site_users" (
  "email" text PRIMARY KEY NOT NULL,
  "name" text,
  "role" text DEFAULT 'commercial' NOT NULL,
  "is_admin" boolean DEFAULT false NOT NULL,
  "can_edit_docs" boolean DEFAULT false NOT NULL,
  "title" text,
  "source" text DEFAULT 'admin' NOT NULL,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doc_folders" (
  "id" text PRIMARY KEY NOT NULL,
  "parent_id" text REFERENCES "doc_folders"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_folders_parent_idx" ON "doc_folders" USING btree ("parent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doc_artifacts" (
  "id" text PRIMARY KEY NOT NULL,
  "folder_id" text NOT NULL REFERENCES "doc_folders"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "search_text" text,
  "created_by" text,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_artifacts_folder_idx" ON "doc_artifacts" USING btree ("folder_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doc_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "artifact_id" text NOT NULL REFERENCES "doc_artifacts"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "html" text NOT NULL,
  "bytes" integer NOT NULL,
  "file_name" text,
  "uploaded_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doc_versions_uq" ON "doc_versions" USING btree ("artifact_id", "version");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doc_upload_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "token_hash" text NOT NULL,
  "label" text,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doc_upload_tokens_hash_uq" ON "doc_upload_tokens" USING btree ("token_hash");
--> statement-breakpoint
-- The first admins. The rest of everyone's access comes from the Slack pass
-- and from the Admin section.
INSERT INTO "site_users" ("email", "name", "role", "is_admin", "can_edit_docs", "source")
VALUES
  ('scott.bernberg@mediaradar.com', 'Scott Bernberg', 'product', true, true, 'seed'),
  ('yael.yehezkeli@mediaradar.com', 'Yael Yehezkeli', 'product', true, true, 'seed')
ON CONFLICT ("email") DO NOTHING;
