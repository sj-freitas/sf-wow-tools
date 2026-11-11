-- How recipes are obtained, as players' GuildAssistant Professions addons saw it (prisma/professions.prisma,
-- RecipeSource; src/professions/recipe-sources.service.ts): gathered from imports, published for
-- GuildAssistant Database. No player or guild in it, only how many users reported each.
-- CreateEnum
CREATE TYPE "recipe_source_kind" AS ENUM ('ITEM', 'TRAINER');

-- CreateTable
CREATE TABLE "recipe_sources" (
    "kind" "recipe_source_kind" NOT NULL,
    "key" TEXT NOT NULL,
    "entry" TEXT NOT NULL,
    "cost" INTEGER,
    "reporters" TEXT[],
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_sources_pkey" PRIMARY KEY ("kind","key","entry")
);

