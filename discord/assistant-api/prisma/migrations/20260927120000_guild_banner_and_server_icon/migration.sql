-- AlterTable
ALTER TABLE "discord_servers" ADD COLUMN     "icon" TEXT;

-- CreateTable
CREATE TABLE "guild_banners" (
    "guild_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_banners_pkey" PRIMARY KEY ("guild_id")
);

-- AddForeignKey
ALTER TABLE "guild_banners" ADD CONSTRAINT "guild_banners_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

