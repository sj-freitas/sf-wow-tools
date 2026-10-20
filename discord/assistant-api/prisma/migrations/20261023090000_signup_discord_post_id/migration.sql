-- The sign-up post's Discord id, kept after the post is deleted or the event archived, so an event
-- can be found by it (SignupEvent.discordPostId). Filled in for events whose post is in Discord now.
BEGIN;

-- AlterTable
ALTER TABLE "signup_events" ADD COLUMN "discord_post_id" TEXT;

UPDATE "signup_events" SET "discord_post_id" = "message_id" WHERE "message_id" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "signup_events_discord_post_id_key" ON "signup_events"("discord_post_id");

COMMIT;
