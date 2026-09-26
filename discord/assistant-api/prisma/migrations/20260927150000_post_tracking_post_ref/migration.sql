-- DropIndex
DROP INDEX "post_tracking_task_id_source_task_id_emoji_type_key";

-- AlterTable
ALTER TABLE "post_tracking" ADD COLUMN     "post_ref" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "post_tracking_task_id_post_ref_emoji_type_key" ON "post_tracking"("task_id", "post_ref", "emoji", "type");


-- Rows made before this column existed pointed at posts by id.
UPDATE "post_tracking" SET "post_ref" = 'id:' || "source_task_id"::text WHERE "post_ref" = '';
