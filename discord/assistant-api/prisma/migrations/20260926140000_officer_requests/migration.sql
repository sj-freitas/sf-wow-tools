-- CreateEnum
CREATE TYPE "OfficerMessageAuthor" AS ENUM ('USER', 'OFFICER');

-- AlterTable
ALTER TABLE "guilds" ADD COLUMN     "officer_request_channel_id" TEXT,
ADD COLUMN     "officer_request_server_id" TEXT;

-- CreateTable
CREATE TABLE "officer_conversations" (
    "id" UUID NOT NULL,
    "guild_id" UUID NOT NULL,
    "public_id" INTEGER NOT NULL,
    "is_anonymous" BOOLEAN NOT NULL,
    "user_discord_id" TEXT NOT NULL,
    "user_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "officer_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "officer_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "author" "OfficerMessageAuthor" NOT NULL,
    "officer_discord_id" TEXT,
    "officer_name" TEXT,
    "content" TEXT NOT NULL,
    "discord_message_id" TEXT,
    "dm_delivered" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "officer_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "officer_conversations_guild_id_updated_at_idx" ON "officer_conversations"("guild_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "officer_conversations_guild_id_public_id_key" ON "officer_conversations"("guild_id", "public_id");

-- CreateIndex
CREATE INDEX "officer_messages_conversation_id_created_at_idx" ON "officer_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "officer_conversations" ADD CONSTRAINT "officer_conversations_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officer_messages" ADD CONSTRAINT "officer_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "officer_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

