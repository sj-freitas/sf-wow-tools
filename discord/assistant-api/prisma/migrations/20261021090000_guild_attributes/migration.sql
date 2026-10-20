-- Guild attributes: labels a guild gives its characters (GuildAttribute, CharacterAttribute).
-- New tables only. One transaction, so a failure leaves nothing behind.
BEGIN;

-- CreateTable
CREATE TABLE "guild_attributes" (
    "id" UUID NOT NULL,
    "guild_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guild_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_attributes" (
    "attribute_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_attributes_pkey" PRIMARY KEY ("attribute_id","character_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guild_attributes_guild_id_name_key" ON "guild_attributes"("guild_id", "name");

-- CreateIndex
CREATE INDEX "character_attributes_character_id_idx" ON "character_attributes"("character_id");

-- AddForeignKey
ALTER TABLE "guild_attributes" ADD CONSTRAINT "guild_attributes_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_attributes" ADD CONSTRAINT "character_attributes_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "guild_attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_attributes" ADD CONSTRAINT "character_attributes_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
