-- Officers' private notes about characters, per guild (CharacterOfficerNote, with images).
-- New tables only. One transaction, so a failure leaves nothing behind.
BEGIN;

-- CreateTable
CREATE TABLE "character_officer_notes" (
    "id" UUID NOT NULL,
    "guild_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "markdown" TEXT NOT NULL DEFAULT '',
    "updated_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "character_officer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_officer_note_images" (
    "id" UUID NOT NULL,
    "note_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_officer_note_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "character_officer_notes_guild_id_character_id_key" ON "character_officer_notes"("guild_id", "character_id");

-- CreateIndex
CREATE INDEX "character_officer_note_images_note_id_created_at_idx" ON "character_officer_note_images"("note_id", "created_at");

-- AddForeignKey
ALTER TABLE "character_officer_notes" ADD CONSTRAINT "character_officer_notes_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_officer_notes" ADD CONSTRAINT "character_officer_notes_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_officer_note_images" ADD CONSTRAINT "character_officer_note_images_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "character_officer_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
