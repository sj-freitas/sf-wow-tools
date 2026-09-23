-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "discord_access_token" TEXT,
ADD COLUMN     "discord_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "discord_token_expires_at" TIMESTAMP(3);

