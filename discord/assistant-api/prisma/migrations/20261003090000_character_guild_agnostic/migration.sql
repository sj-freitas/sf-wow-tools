-- Characters now belong to a player and a server (gameVersion/region/realm), not a guild. A
-- player is one row per Discord account globally (not one per guild any more), and which guilds a
-- character is in is a separate table (character_guild_memberships) — "migrating" a character
-- just adds a row there, it never copies the character.

-- Step 1: add the character's new server columns, nullable for now (backfilled below). (bio and
-- bio_visible are NOT added here: migration 20261002090000_character_bio already added them.)
-- IF NOT EXISTS: an earlier, buggy run of this same migration got this far (and no further)
-- before failing on a duplicate bio column, and Postgres does not roll that back on later failure.
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "game_version" TEXT;
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "realm" TEXT;

-- Step 2: the new guild-membership table, while player_id -> players.guild_id -> guilds is still
-- intact, so both it and the server columns above can be backfilled from that chain.
CREATE TABLE "character_guild_memberships" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "guild_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_guild_memberships_pkey" PRIMARY KEY ("id")
);

-- Step 3: backfill both from the existing character -> player -> guild chain.
UPDATE "characters" c
SET "game_version" = g."game_version", "region" = g."region", "realm" = g."realm"
FROM "players" p
JOIN "guilds" g ON g."id" = p."guild_id"
WHERE c."player_id" = p."id";

INSERT INTO "character_guild_memberships" ("id", "character_id", "guild_id", "created_at")
SELECT gen_random_uuid(), c."id", p."guild_id", c."created_at"
FROM "characters" c
JOIN "players" p ON p."id" = c."player_id";

ALTER TABLE "characters" ALTER COLUMN "game_version" SET NOT NULL;
ALTER TABLE "characters" ALTER COLUMN "region" SET NOT NULL;
ALTER TABLE "characters" ALTER COLUMN "realm" SET NOT NULL;

-- Step 4: merge players that are the same Discord account in different guilds (one row per
-- (guild, Discord user) until now) into a single global row — the oldest one — repointing their
-- characters first.
CREATE TEMP TABLE "player_keepers" AS
SELECT DISTINCT ON ("discord_user_id") "discord_user_id", "id" AS "keeper_id"
FROM "players"
ORDER BY "discord_user_id", "created_at" ASC;

UPDATE "characters" c
SET "player_id" = k."keeper_id"
FROM "players" p
JOIN "player_keepers" k ON k."discord_user_id" = p."discord_user_id"
WHERE c."player_id" = p."id" AND p."id" <> k."keeper_id";

DELETE FROM "players" p
WHERE NOT EXISTS (SELECT 1 FROM "player_keepers" k WHERE k."keeper_id" = p."id");

DROP TABLE "player_keepers";

-- Step 5: players are no longer per guild.
ALTER TABLE "players" DROP CONSTRAINT "players_guild_id_fkey";
DROP INDEX "players_guild_id_discord_user_id_key";
ALTER TABLE "players" DROP COLUMN "guild_id";
CREATE UNIQUE INDEX "players_discord_user_id_key" ON "players"("discord_user_id");

-- Step 6: a character's name only needs to be unique per player and server now, not per guild
-- (it no longer has one).
DROP INDEX "characters_player_id_first_name_last_name_key";
CREATE UNIQUE INDEX "characters_unique_per_server" ON "characters"("player_id", "game_version", "region", "realm", "first_name", "last_name");

-- Step 7: finish the guild-membership table and add the bio's images.
CREATE INDEX "character_guild_memberships_guild_id_idx" ON "character_guild_memberships"("guild_id");
CREATE UNIQUE INDEX "character_guild_memberships_character_id_guild_id_key" ON "character_guild_memberships"("character_id", "guild_id");
ALTER TABLE "character_guild_memberships" ADD CONSTRAINT "character_guild_memberships_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "character_guild_memberships" ADD CONSTRAINT "character_guild_memberships_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "character_images" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_images_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "character_images_character_id_created_at_idx" ON "character_images"("character_id", "created_at");
ALTER TABLE "character_images" ADD CONSTRAINT "character_images_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
