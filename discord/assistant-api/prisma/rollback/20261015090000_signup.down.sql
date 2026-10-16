-- Removes the event sign-up feature's data and tables: the reverse of
-- prisma/migrations/20261015090000_signup, 20261016090000_signup_archive,
-- 20261017090000_signup_event_kind and 20261018090000_signup_schedule. Nothing outside the
-- signup_* tables is touched.
--
-- Run it (with DATABASE_URL set) from discord/assistant-api:
--   npx prisma db execute --file prisma/rollback/20261015090000_signup.down.sql
-- then take the code out as the README's "Removing the sign-up feature" says. It also forgets
-- the migration, so deploying the old code afterwards is clean, and deploying the feature again
-- re-creates everything (empty).
--
-- This deletes every event, sign-up, setup and assignment for good.
BEGIN;

DROP TABLE IF EXISTS "signup_images";
DROP TABLE IF EXISTS "signup_assignments";
DROP TABLE IF EXISTS "signup_contacts";
DROP TABLE IF EXISTS "signup_entries";
DROP TABLE IF EXISTS "signup_events";
DROP TABLE IF EXISTS "signup_settings";

DROP TYPE IF EXISTS "signup_assignment_scope";
DROP TYPE IF EXISTS "signup_event_kind";
DROP TYPE IF EXISTS "signup_lock_mode";
DROP TYPE IF EXISTS "signup_status";

DELETE FROM "_prisma_migrations"
  WHERE "migration_name" IN (
    '20261015090000_signup',
    '20261016090000_signup_archive',
    '20261017090000_signup_event_kind',
    '20261018090000_signup_schedule'
  );

COMMIT;
