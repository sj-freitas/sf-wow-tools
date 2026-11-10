-- Upload keys (prisma/upload-keys.prisma, src/upload-keys): what the Guild Assistant Uploader sends
-- to upload a player's professions file for them. Only each key's SHA-256 is stored.
-- CreateTable
CREATE TABLE "upload_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upload_keys_key_hash_key" ON "upload_keys"("key_hash");

-- CreateIndex
CREATE INDEX "upload_keys_user_id_idx" ON "upload_keys"("user_id");

-- AddForeignKey
ALTER TABLE "upload_keys" ADD CONSTRAINT "upload_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

