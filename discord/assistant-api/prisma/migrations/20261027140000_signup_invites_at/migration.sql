-- When raid invites start, before the event (optional): shown on the sign-up post and exported to
-- Raid Sort, whose Auto-Invite invites from then until the start.
ALTER TABLE "signup_events" ADD COLUMN "invites_at" TIMESTAMP(3);
