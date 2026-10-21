-- A character's "main" flag goes: each guild says what a main is with its own attributes (e.g. an
-- attribute named "Main"), set on the roster. The flags set so far are dropped with the column.
ALTER TABLE "characters" DROP COLUMN "is_main";
