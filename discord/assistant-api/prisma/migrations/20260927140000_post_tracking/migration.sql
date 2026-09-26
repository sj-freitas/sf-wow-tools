-- CreateTable
CREATE TABLE "post_tracking" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "source_task_id" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "last_hash" TEXT,
    "last_users" JSONB NOT NULL DEFAULT '[]',
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_tracking_source_task_id_idx" ON "post_tracking"("source_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "post_tracking_task_id_source_task_id_emoji_type_key" ON "post_tracking"("task_id", "source_task_id", "emoji", "type");

-- AddForeignKey
ALTER TABLE "post_tracking" ADD CONSTRAINT "post_tracking_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_tracking" ADD CONSTRAINT "post_tracking_source_task_id_fkey" FOREIGN KEY ("source_task_id") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

