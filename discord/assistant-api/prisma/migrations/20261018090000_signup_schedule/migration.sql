-- Event sign-ups: scheduled events (prisma/signup.prisma, SignupEvent.publishAt/publishError), posted
-- by the worker at a set time instead of at once; and an optional location (SignupEvent.location).
-- Only touches signup_events. Undone by
-- prisma/rollback/20261015090000_signup.down.sql with the rest.
BEGIN;

-- AlterTable
ALTER TABLE "signup_events" ADD COLUMN "location" TEXT NOT NULL DEFAULT '',
ADD COLUMN "publish_at" TIMESTAMP(3),
ADD COLUMN "publish_error" TEXT;

-- CreateIndex
CREATE INDEX "signup_events_publish_at_idx" ON "signup_events"("publish_at");

COMMIT;
