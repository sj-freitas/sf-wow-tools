-- Plugins: GuildPlugin and PluginRun (prisma/plugins.prisma), and MONTHLY schedules for them.
-- New tables, a new enum and a new enum value only. One transaction, so a failure leaves nothing
-- behind (the new ScheduleKind value is not used in it, which Postgres allows).
BEGIN;

-- CreateEnum
CREATE TYPE "plugin_kind" AS ENUM ('CHANNEL_CLEANUP');

-- AlterEnum
ALTER TYPE "ScheduleKind" ADD VALUE 'MONTHLY';

-- CreateTable
CREATE TABLE "guild_plugins" (
    "id" UUID NOT NULL,
    "guild_id" UUID NOT NULL,
    "kind" "plugin_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule_kind" "ScheduleKind" NOT NULL,
    "time_of_day" TEXT NOT NULL,
    "weekday" INTEGER,
    "day_of_month" INTEGER,
    "next_run_at" TIMESTAMP(3),
    "lease_until" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_status" "TaskRunStatus",
    "last_error" TEXT,
    "last_result" TEXT,
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_plugins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_runs" (
    "id" UUID NOT NULL,
    "plugin_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL,
    "status" "TaskRunStatus" NOT NULL,
    "result" TEXT,
    "error" TEXT,

    CONSTRAINT "plugin_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guild_plugins_guild_id_idx" ON "guild_plugins"("guild_id");

-- CreateIndex
CREATE INDEX "guild_plugins_enabled_next_run_at_idx" ON "guild_plugins"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "plugin_runs_plugin_id_started_at_idx" ON "plugin_runs"("plugin_id", "started_at");

-- AddForeignKey
ALTER TABLE "guild_plugins" ADD CONSTRAINT "guild_plugins_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_runs" ADD CONSTRAINT "plugin_runs_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "guild_plugins"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
