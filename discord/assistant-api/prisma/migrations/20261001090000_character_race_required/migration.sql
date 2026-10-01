-- Race is no longer allowed to be unset: every character now has one (checked against the
-- guild's faction and class by the API, not here, like class already is). The backfill is a
-- safety net, not an expected case: everything should already have a real race by now.
UPDATE "characters" SET "race" = 'Human' WHERE "race" = '';

-- AlterTable
ALTER TABLE "characters" ALTER COLUMN "race" DROP DEFAULT;
ALTER TABLE "characters" ADD CONSTRAINT "characters_race_not_empty" CHECK ("race" <> '');
