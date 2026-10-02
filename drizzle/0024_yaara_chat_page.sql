-- The chat panel inside the portfolio (added 1 October 2026) asks through the
-- same relay as Open WebUI, and carries the page the person had open, so
-- Yaara can answer "what about this one?" without being told what "this" is.
ALTER TABLE "yaara_chats" ADD COLUMN IF NOT EXISTS "surface" text DEFAULT 'open-webui' NOT NULL;
--> statement-breakpoint
ALTER TABLE "yaara_chats" ADD COLUMN IF NOT EXISTS "page" text;
