-- Event sign-ups: raid roles shown in the setup (prisma/signup.prisma): the event's leader and
-- master looter, and who has assist. Only touches signup_events and signup_entries. Undone by
-- prisma/rollback/20261015090000_signup.down.sql with the rest.
BEGIN;

-- AlterTable
ALTER TABLE "signup_events" ADD COLUMN "leader_discord_user_id" TEXT,
ADD COLUMN "master_looter_discord_user_id" TEXT;

-- AlterTable
ALTER TABLE "signup_entries" ADD COLUMN "assist" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
