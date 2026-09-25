-- DropIndex
DROP INDEX "guilds_name_realm_game_version_key";

-- CreateIndex
CREATE UNIQUE INDEX "guilds_name_realm_game_version_region_key" ON "guilds"("name", "realm", "game_version", "region");

