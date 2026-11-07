-- A character's name is unique on its server (its rule set, in Forever), whoever plays it: the game
-- has one character per name there. Before, it was unique per player and server, so two players
-- could each register the same name.
DROP INDEX "characters_unique_per_server";
CREATE UNIQUE INDEX "characters_unique_per_server" ON "characters"("game_version", "region", "realm", "first_name", "last_name");

-- The player's characters were found through that index (player_id came first): their own one now.
CREATE INDEX "characters_player_id_idx" ON "characters"("player_id");
