-- Event sign-ups: the kind of event (prisma/signup.prisma, SignupEvent.kind): characters (the
-- existing behaviour, so every existing event gets it) or members. Only touches signup_events.
-- Undone by prisma/rollback/20261015090000_signup.down.sql with the rest.
BEGIN;

-- CreateEnum
CREATE TYPE "signup_event_kind" AS ENUM ('CHARACTERS', 'MEMBERS');

-- AlterTable
ALTER TABLE "signup_events" ADD COLUMN "kind" "signup_event_kind" NOT NULL DEFAULT 'CHARACTERS';

COMMIT;
