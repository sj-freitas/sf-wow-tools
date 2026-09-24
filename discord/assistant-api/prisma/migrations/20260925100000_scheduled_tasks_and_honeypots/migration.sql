-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('POST');

-- CreateEnum
CREATE TYPE "ScheduleKind" AS ENUM ('ONCE', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "TaskRunStatus" AS ENUM ('SUCCESS', 'FAILED', 'MISSED');

-- CreateEnum
CREATE TYPE "HoneypotAction" AS ENUM ('WOULD_BAN', 'BANNED', 'FAILED');

-- AlterTable
ALTER TABLE "guilds" ADD COLUMN     "region" TEXT NOT NULL DEFAULT 'EU';

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" UUID NOT NULL,
    "guild_id" UUID NOT NULL,
    "type" "TaskType" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule_kind" "ScheduleKind" NOT NULL,
    "run_at" TIMESTAMP(3),
    "time_of_day" TEXT,
    "weekday" INTEGER,
    "next_run_at" TIMESTAMP(3),
    "lease_until" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_status" "TaskRunStatus",
    "last_error" TEXT,
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_runs" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" "TaskRunStatus" NOT NULL,
    "error" TEXT,

    CONSTRAINT "task_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "honeypots" (
    "id" UUID NOT NULL,
    "guild_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "test_mode" BOOLEAN NOT NULL DEFAULT true,
    "discord_server_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "log_channel_id" TEXT NOT NULL,
    "created_channel" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "honeypots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "honeypot_events" (
    "id" UUID NOT NULL,
    "honeypot_id" UUID NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "username" TEXT,
    "message_id" TEXT,
    "action" "HoneypotAction" NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "honeypot_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_tasks_enabled_next_run_at_idx" ON "scheduled_tasks"("enabled", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_runs_task_id_scheduled_for_key" ON "task_runs"("task_id", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "honeypots_channel_id_key" ON "honeypots"("channel_id");

-- CreateIndex
CREATE INDEX "honeypot_events_honeypot_id_created_at_idx" ON "honeypot_events"("honeypot_id", "created_at");

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "honeypots" ADD CONSTRAINT "honeypots_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "honeypot_events" ADD CONSTRAINT "honeypot_events_honeypot_id_fkey" FOREIGN KEY ("honeypot_id") REFERENCES "honeypots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

