-- CreateTable
CREATE TABLE "officer_attachments" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "officer_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "officer_attachments_message_id_key" ON "officer_attachments"("message_id");

-- AddForeignKey
ALTER TABLE "officer_attachments" ADD CONSTRAINT "officer_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "officer_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

