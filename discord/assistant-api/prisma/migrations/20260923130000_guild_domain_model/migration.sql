-- CreateEnum
CREATE TYPE "Role" AS ENUM ('HEALER', 'TANK', 'MELEE_DPS', 'RANGED_DPS');

-- DropForeignKey
ALTER TABLE "players" DROP CONSTRAINT "players_guild_id_fkey";

-- DropIndex
DROP INDEX "guilds_discord_id_key";

-- DropIndex
DROP INDEX "guilds_name_realm_key";

-- DropIndex
DROP INDEX "players_name_realm_key";

-- AlterTable
ALTER TABLE "guilds" DROP COLUMN "discord_id",
ADD COLUMN     "game_version" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "players" DROP COLUMN "class",
DROP COLUMN "faction",
DROP COLUMN "level",
DROP COLUMN "name",
DROP COLUMN "realm",
ADD COLUMN     "discord_user_id" TEXT NOT NULL,
ALTER COLUMN "guild_id" SET NOT NULL;

-- CreateTable
CREATE TABLE "discord_servers" (
    "id" UUID NOT NULL,
    "discord_id" TEXT NOT NULL,
    "guild_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discord_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "class" TEXT NOT NULL,
    "roles" "Role"[],
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL DEFAULT '',
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "level" INTEGER NOT NULL DEFAULT 1,
    "faction" "Faction" NOT NULL,
    "realm" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discord_servers_discord_id_key" ON "discord_servers"("discord_id");

-- CreateIndex
CREATE UNIQUE INDEX "characters_player_id_first_name_last_name_realm_key" ON "characters"("player_id", "first_name", "last_name", "realm");

-- CreateIndex
CREATE UNIQUE INDEX "guilds_name_realm_game_version_key" ON "guilds"("name", "realm", "game_version");

-- CreateIndex
CREATE UNIQUE INDEX "players_guild_id_discord_user_id_key" ON "players"("guild_id", "discord_user_id");

-- AddForeignKey
ALTER TABLE "discord_servers" ADD CONSTRAINT "discord_servers_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

