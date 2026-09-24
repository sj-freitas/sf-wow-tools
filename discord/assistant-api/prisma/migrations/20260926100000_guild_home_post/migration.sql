-- AlterTable
ALTER TABLE "guilds" ADD COLUMN     "home_markdown" TEXT,
ADD COLUMN     "home_updated_at" TIMESTAMP(3),
ADD COLUMN     "home_updated_by_id" UUID;

