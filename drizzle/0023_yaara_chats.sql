-- Questions asked of Yaara in the portfolio's chat, carried to her and back.
--
-- She cannot be reached from outside her cluster, so the chat screen leaves
-- the question here and she collects it over the agent API, the way she
-- reaches everything else. See src/lib/yaara-chat.ts. Rows are deleted two
-- days after they are asked.

CREATE TABLE IF NOT EXISTS "yaara_chats" (
  "id" text PRIMARY KEY NOT NULL,
  "asked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "asked_by_email" text NOT NULL,
  "asked_by_name" text,
  "chat_id" text,
  "messages" text NOT NULL,
  -- queued | working | answered | failed | abandoned
  "status" text DEFAULT 'queued' NOT NULL,
  "claimed_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "progress" text DEFAULT '[]' NOT NULL,
  "reply" text,
  "model" text,
  "served_by" text,
  "error" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "yaara_chats_status_idx" ON "yaara_chats" USING btree ("status","asked_at");
