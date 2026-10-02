-- A character's bio: free text written by its own player, shown to others only when bioVisible
-- is set. Only offered on guilds whose server's rule set is 'RP' (src/game/<version>/config.ts),
-- checked by the API, not here. The length limit is enforced by the API too, like other free text
-- (welcome posts, messages).

-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "bio" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bio_visible" BOOLEAN NOT NULL DEFAULT false;
