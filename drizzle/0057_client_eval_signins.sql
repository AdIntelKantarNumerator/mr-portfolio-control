-- Client Evaluation (23 November 2026): Magnifier last logins from the SSO
-- user pool (AWS Cognito), kept on our side so a refresh reads only people whose
-- history is a day old (lib/client-eval/cognito-signins.ts). Keyed by email.
CREATE TABLE IF NOT EXISTS "ce_signins" (
  "email" text PRIMARY KEY NOT NULL,
  "username" text NOT NULL,
  "status" text NOT NULL,
  "last_signin" timestamp with time zone,
  "logins30" integer DEFAULT 0 NOT NULL,
  "checked_at" timestamp with time zone
);
