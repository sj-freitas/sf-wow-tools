-- Event sign-ups (prisma/signup.prisma). Only new signup_* tables and types; nothing existing is
-- changed. One transaction, so a failure leaves nothing behind. Undo with
-- prisma/rollback/20261015090000_signup.down.sql (see the README).
BEGIN;

-- CreateEnum
CREATE TYPE "signup_status" AS ENUM ('AVAILABLE', 'LATE', 'TENTATIVE', 'ABSENT');

-- CreateEnum
CREATE TYPE "signup_lock_mode" AS ENUM ('AUTO', 'LOCKED', 'UNLOCKED');

-- CreateEnum
CREATE TYPE "signup_assignment_scope" AS ENUM ('GLOBAL', 'RAID', 'BOSS');

-- CreateTable
CREATE TABLE "signup_settings" (
    "guild_id" UUID NOT NULL,
    "channel_server_id" TEXT,
    "channel_id" TEXT,
    "event_creator_role_id" TEXT,
    "event_creator_role_name" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signup_settings_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "signup_events" (
    "id" UUID NOT NULL,
    "guild_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "message_id" TEXT,
    "created_by_discord_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "lock_mode" "signup_lock_mode" NOT NULL DEFAULT 'AUTO',
    "closed_shown" BOOLEAN NOT NULL DEFAULT false,
    "setup_message_id" TEXT,
    "setup_mentions" BOOLEAN NOT NULL DEFAULT false,
    "plugin_key" TEXT,
    "plugin_auto_run" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signup_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signup_entries" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "discord_name" TEXT NOT NULL,
    "character_id" UUID,
    "role" "Role",
    "status" "signup_status" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "group_number" INTEGER,
    "group_slot" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signup_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signup_contacts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "sent_by_discord_id" TEXT NOT NULL,
    "sent_by_name" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signup_assignments" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "scope" "signup_assignment_scope" NOT NULL,
    "scope_label" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "mentions" BOOLEAN NOT NULL DEFAULT false,
    "message_id" TEXT,
    "plugin_key" TEXT,
    "edited_manually" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signup_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signup_images" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "assignment_id" UUID,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signup_events_guild_id_starts_at_idx" ON "signup_events"("guild_id", "starts_at");

-- CreateIndex
CREATE INDEX "signup_events_lock_mode_closed_shown_starts_at_idx" ON "signup_events"("lock_mode", "closed_shown", "starts_at");

-- CreateIndex
CREATE INDEX "signup_entries_character_id_idx" ON "signup_entries"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "signup_entries_event_id_discord_user_id_key" ON "signup_entries"("event_id", "discord_user_id");

-- CreateIndex
CREATE INDEX "signup_contacts_event_id_discord_user_id_idx" ON "signup_contacts"("event_id", "discord_user_id");

-- CreateIndex
CREATE INDEX "signup_assignments_event_id_position_idx" ON "signup_assignments"("event_id", "position");

-- CreateIndex
CREATE INDEX "signup_images_event_id_assignment_id_idx" ON "signup_images"("event_id", "assignment_id");

-- AddForeignKey
ALTER TABLE "signup_settings" ADD CONSTRAINT "signup_settings_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signup_events" ADD CONSTRAINT "signup_events_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signup_entries" ADD CONSTRAINT "signup_entries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "signup_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signup_entries" ADD CONSTRAINT "signup_entries_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signup_contacts" ADD CONSTRAINT "signup_contacts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "signup_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signup_assignments" ADD CONSTRAINT "signup_assignments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "signup_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signup_images" ADD CONSTRAINT "signup_images_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "signup_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signup_images" ADD CONSTRAINT "signup_images_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "signup_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
