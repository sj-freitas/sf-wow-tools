-- What a trainer's window says a recipe requires besides the profession (a specialization: "Goblin
-- Engineer"), as GuildAssistant Professions 1.4.0 records it (prisma/professions.prisma,
-- RecipeSource; src/professions/recipe-sources.service.ts): rows of their own, by the trainer
-- recipe's key.
-- AlterEnum
ALTER TYPE "recipe_source_kind" ADD VALUE 'REQUIREMENT';
