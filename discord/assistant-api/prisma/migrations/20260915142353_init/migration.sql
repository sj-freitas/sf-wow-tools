-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Faction" AS ENUM ('ALLIANCE', 'HORDE');

-- CreateTable
CREATE TABLE "guilds" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "faction" "Faction" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guilds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "faction" "Faction" NOT NULL,
    "guild_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guilds_name_realm_key" ON "guilds"("name", "realm");

-- CreateIndex
CREATE UNIQUE INDEX "players_name_realm_key" ON "players"("name", "realm");

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
