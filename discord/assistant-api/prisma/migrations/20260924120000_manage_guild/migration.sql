-- AlterTable
ALTER TABLE "guilds" ADD COLUMN     "officer_role_id" TEXT,
ADD COLUMN     "officer_role_name" TEXT;

-- AlterTable
ALTER TABLE "discord_servers" ADD COLUMN     "is_main" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "players" ADD COLUMN     "discord_display_name" TEXT,
ADD COLUMN     "discord_username" TEXT;

-- AlterTable
ALTER TABLE "guild_access" ADD COLUMN     "is_officer" BOOLEAN NOT NULL DEFAULT false;


-- Existing guilds: the oldest server becomes the main one.
UPDATE "discord_servers" SET "is_main" = true
WHERE "id" IN (SELECT DISTINCT ON ("guild_id") "id" FROM "discord_servers" ORDER BY "guild_id", "created_at");
