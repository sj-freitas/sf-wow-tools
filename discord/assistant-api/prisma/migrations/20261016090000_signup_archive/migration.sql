-- Event sign-ups: archived events (prisma/signup.prisma, SignupEvent.archivedAt). Only touches
-- signup_events. Undone by prisma/rollback/20261015090000_signup.down.sql with the rest.
BEGIN;

-- AlterTable
ALTER TABLE "signup_events" ADD COLUMN "archived_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "signup_events_guild_id_archived_at_idx" ON "signup_events"("guild_id", "archived_at");

COMMIT;
