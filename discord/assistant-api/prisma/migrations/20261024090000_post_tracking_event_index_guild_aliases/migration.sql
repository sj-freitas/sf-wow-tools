-- Posts: live updates can be turned off per post (scheduled_tasks.tracked, on for every existing
-- post), and the reaction counts the backoffice shows are kept on the post (reaction_counts).
-- Sign-up events: an index on message_id, which every message deleted in Discord is looked up by.
-- Guilds: the addresses they had before a rename (guild_path_aliases), redirected to the current one.
-- New columns, a new table and indexes only. One transaction.
BEGIN;

-- AlterTable
ALTER TABLE "scheduled_tasks" ADD COLUMN     "reaction_counts" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "tracked" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "guild_path_aliases" (
    "path" TEXT NOT NULL,
    "guild_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guild_path_aliases_pkey" PRIMARY KEY ("path")
);

-- CreateIndex
CREATE INDEX "guild_path_aliases_guild_id_idx" ON "guild_path_aliases"("guild_id");

-- CreateIndex
CREATE INDEX "signup_events_message_id_idx" ON "signup_events"("message_id");

-- AddForeignKey
ALTER TABLE "guild_path_aliases" ADD CONSTRAINT "guild_path_aliases_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
