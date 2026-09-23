-- Characters no longer store faction/realm: they come from the owning guild.
DROP INDEX "characters_player_id_first_name_last_name_realm_key";

ALTER TABLE "characters" DROP COLUMN "faction",
DROP COLUMN "realm";

CREATE UNIQUE INDEX "characters_player_id_first_name_last_name_key" ON "characters"("player_id", "first_name", "last_name");

-- guild_members -> guild_access (rename in place to keep existing rows).
ALTER TABLE "guild_members" RENAME TO "guild_access";
ALTER TABLE "guild_access" RENAME CONSTRAINT "guild_members_pkey" TO "guild_access_pkey";
ALTER TABLE "guild_access" RENAME CONSTRAINT "guild_members_user_id_fkey" TO "guild_access_user_id_fkey";
ALTER TABLE "guild_access" RENAME CONSTRAINT "guild_members_guild_id_fkey" TO "guild_access_guild_id_fkey";
