-- When the worker last looked the character up in its version's armory (null: never).
ALTER TABLE "characters" ADD COLUMN "armory_checked_at" TIMESTAMP(3);
CREATE INDEX "characters_armory_checked_at_idx" ON "characters"("armory_checked_at");
