-- Unclaimed characters: an Officer can add a character (from the armory) without knowing who plays it.
-- It has no player until a member claims it or an Officer gives it to someone.
ALTER TABLE "characters" ALTER COLUMN "player_id" DROP NOT NULL;
