-- Guild problems: what the bot currently can't do for a guild and an officer can fix. One row per
-- failing task, deleted when it next succeeds.
CREATE TYPE "problem_source" AS ENUM ('POST', 'PLUGIN', 'EVENT', 'HONEYPOT');

CREATE TABLE "guild_problems" (
    "id" UUID NOT NULL,
    "guild_id" UUID NOT NULL,
    "source" "problem_source" NOT NULL,
    "source_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "channel_id" TEXT,
    "detail" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guild_problems_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "guild_problems_guild_id_source_source_id_key" ON "guild_problems"("guild_id", "source", "source_id");

ALTER TABLE "guild_problems" ADD CONSTRAINT "guild_problems_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
