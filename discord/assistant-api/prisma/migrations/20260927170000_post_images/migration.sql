-- CreateTable
CREATE TABLE "post_images" (
    "id" UUID NOT NULL,
    "guild_id" UUID NOT NULL,
    "task_id" UUID,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_images_task_id_idx" ON "post_images"("task_id");

-- CreateIndex
CREATE INDEX "post_images_guild_id_task_id_created_at_idx" ON "post_images"("guild_id", "task_id", "created_at");

-- AddForeignKey
ALTER TABLE "post_images" ADD CONSTRAINT "post_images_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

