-- AlterTable
ALTER TABLE "discord_servers" ADD COLUMN     "name" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "user_admin_servers" (
    "user_id" UUID NOT NULL,
    "discord_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "user_admin_servers_pkey" PRIMARY KEY ("user_id","discord_id")
);

-- AddForeignKey
ALTER TABLE "user_admin_servers" ADD CONSTRAINT "user_admin_servers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

