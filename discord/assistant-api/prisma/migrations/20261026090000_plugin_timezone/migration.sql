-- A plugin's own schedule timezone (null: the guild's server time, as before).
ALTER TABLE "guild_plugins" ADD COLUMN "timezone" TEXT;
