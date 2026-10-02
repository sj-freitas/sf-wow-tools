-- A character's faction, explicit again: some races (Forever's Skyborne, like Pandaren) exist in
-- both factions, so it cannot be derived from race alone. Backfilled from one of the character's
-- current guild memberships (a character was only ever added to a guild whose faction matched);
-- one left with no guild at all (already migrated away from all of them) falls back to Alliance,
-- an arbitrary tie-break — there is no record of which faction it was.
ALTER TABLE "characters" ADD COLUMN "faction" "Faction";

UPDATE "characters" c
SET "faction" = g."faction"
FROM "character_guild_memberships" cgm
JOIN "guilds" g ON g."id" = cgm."guild_id"
WHERE cgm."character_id" = c."id" AND c."faction" IS NULL;

UPDATE "characters" SET "faction" = 'ALLIANCE' WHERE "faction" IS NULL;

ALTER TABLE "characters" ALTER COLUMN "faction" SET NOT NULL;
