-- Professions (prisma/professions.prisma): each character's professions and recipes, imported
-- from the Guild Assistant Professions addon, and a cache of Wowhead's names for the recipes.

-- CreateEnum
CREATE TYPE "wowhead_kind" AS ENUM ('SPELL', 'ITEM');

-- CreateTable
CREATE TABLE "character_professions" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "skill" INTEGER,
    "max_skill" INTEGER,
    "spell_ids" INTEGER[],
    "item_ids" INTEGER[],
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_professions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wowhead_entries" (
    "kind" "wowhead_kind" NOT NULL,
    "id" INTEGER NOT NULL,
    "english_name" TEXT,
    "icon" TEXT,
    "missing" BOOLEAN NOT NULL DEFAULT false,
    "fetched_at" TIMESTAMP(3),

    CONSTRAINT "wowhead_entries_pkey" PRIMARY KEY ("kind","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "character_professions_character_id_name_key" ON "character_professions"("character_id", "name");

-- AddForeignKey
ALTER TABLE "character_professions" ADD CONSTRAINT "character_professions_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
