-- Client Evaluation (23 November 2026): when each user was created, from each
-- application's own records (360 MASTERUSER.create_d, Magnifier USER.CREATION_DATE;
-- Classic records none, so its first login). YYYY-MM-DD.
ALTER TABLE "ce_users" ADD COLUMN IF NOT EXISTS "created" text;
