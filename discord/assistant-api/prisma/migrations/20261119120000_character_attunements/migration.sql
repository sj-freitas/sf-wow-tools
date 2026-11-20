-- Which raids a character is attuned to, as GuildAssistant Professions 1.6.0 records it in game and
-- the upload carries it (prisma/professions.prisma, CharacterAttunement;
-- src/professions/professions.service.ts). A row only ever gains: an attunement is for good. No row
-- means no addon has looked, which is not the same as not being attuned.
-- CreateTable
CREATE TABLE "character_attunements" (
    "character_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "attuned" BOOLEAN NOT NULL DEFAULT false,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_attunements_pkey" PRIMARY KEY ("character_id","key")
);

-- AddForeignKey
ALTER TABLE "character_attunements" ADD CONSTRAINT "character_attunements_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
