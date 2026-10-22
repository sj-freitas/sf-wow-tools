-- The picture of each server a user may add to a guild (Discord's icon hash; null when the server
-- has none), shown in the create-guild server picker and copied to the guild's server.
ALTER TABLE "user_admin_servers" ADD COLUMN "icon" TEXT;
