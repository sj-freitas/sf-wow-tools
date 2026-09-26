-- AlterTable
ALTER TABLE "post_tracking" ADD COLUMN     "source_channel_id" TEXT,
ADD COLUMN     "source_message_id" TEXT,
ALTER COLUMN "source_task_id" DROP NOT NULL;

