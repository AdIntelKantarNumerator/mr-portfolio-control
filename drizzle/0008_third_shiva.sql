ALTER TABLE "agent_observations" ADD COLUMN "recent" text;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "activity_score" double precision;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "activity_window_hours" integer;