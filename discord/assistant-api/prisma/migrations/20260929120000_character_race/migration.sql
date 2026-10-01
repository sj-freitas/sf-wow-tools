-- A character's race, free-form text like class (checked against the guild's game version and
-- faction by the API, not here). Empty means unknown: characters added before this column
-- existed, or from a path that does not collect it (the Discord `/character-add` command), keep
-- that default until edited in the backoffice.

-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "race" TEXT NOT NULL DEFAULT '';
