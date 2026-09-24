-- CreateEnum
CREATE TYPE "GuildRole" AS ENUM ('RAIDER', 'SOCIAL');

-- CreateTable
CREATE TABLE "guild_role_mappings" (
    "id" UUID NOT NULL,
    "guild_id" UUID NOT NULL,
    "guild_role" "GuildRole" NOT NULL,
    "discord_role_id" TEXT NOT NULL,
    "discord_role_name" TEXT NOT NULL,

    CONSTRAINT "guild_role_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guild_role_mappings_guild_id_guild_role_key" ON "guild_role_mappings"("guild_id", "guild_role");

-- AddForeignKey
ALTER TABLE "guild_role_mappings" ADD CONSTRAINT "guild_role_mappings_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

