-- Professions merge on import (recipes only ever added); the addon's history of each profession;
-- the main professions dropped from a character (by hand, or because a newer export no longer had
-- them), which an import doesn't bring back unless learned again after the drop; and the date of
-- the newest export applied to each character.
ALTER TABLE "character_professions" ADD COLUMN "learned_at" TIMESTAMP(3);
ALTER TABLE "character_professions" ADD COLUMN "recorded_at" TIMESTAMP(3);

CREATE TABLE "profession_drops" (
    "character_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "dropped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profession_drops_pkey" PRIMARY KEY ("character_id","name")
);

ALTER TABLE "profession_drops" ADD CONSTRAINT "profession_drops_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "profession_snapshots" (
    "character_id" UUID NOT NULL,
    "taken_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profession_snapshots_pkey" PRIMARY KEY ("character_id")
);

ALTER TABLE "profession_snapshots" ADD CONSTRAINT "profession_snapshots_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
