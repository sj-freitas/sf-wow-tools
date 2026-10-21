-- When a character's player verified on Battle.net that it is theirs: from then on Officers can't
-- edit or move it. Null (claimed by its player, as every character is) until then.
ALTER TABLE "characters" ADD COLUMN "verified_at" TIMESTAMP(3);
