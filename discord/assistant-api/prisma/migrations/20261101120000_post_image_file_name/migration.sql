-- The name a post's file (a PDF, ...) is sent under; null for images, which get a plain name.
ALTER TABLE "post_images" ADD COLUMN "file_name" TEXT;
