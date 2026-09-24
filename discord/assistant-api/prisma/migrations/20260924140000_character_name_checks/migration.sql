-- Names are at least 2 characters; the last name may be empty. Whether a last name is
-- *required* depends on the guild's game version and is enforced by the API
-- (src/game/game-version.ts), since a CHECK can't look at another table.
ALTER TABLE "characters" ADD CONSTRAINT "characters_first_name_min_length" CHECK (char_length("first_name") >= 2);
ALTER TABLE "characters" ADD CONSTRAINT "characters_last_name_min_length" CHECK ("last_name" = '' OR char_length("last_name") >= 2);
