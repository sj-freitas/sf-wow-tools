/**
 * Deletes every character's professions, keeping the characters: whatever was imported while
 * testing goes, and players import again. `npm run professions:wipe` deletes at once
 * (`npm run professions:wipe -- --dry-run` only counts). A one-off CLI script, like `characters:wipe`; it needs
 * DATABASE_URL.
 *
 * Deleted: imported professions and their recipes (`character_professions`), the dropped
 * professions' history (`profession_drops`) and the dates of the last import per character
 * (`profession_snapshots`), so the next import starts fresh. Kept: characters and everything else,
 * and the Wowhead cache of recipe names (`wowhead_entries`: about recipes, not characters).
 * Professions List plugins check for changes at once, so their posted lists empty out.
 *
 * The addon's own saved data is per player, in the game's folder (WTF/Account/<account>/
 * SavedVariables/GuildAssistantProfessions.lua): delete that file with the game closed to start
 * the addon over too. Guildmates' addons still hold what they received and share it again.
 */
import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { PrismaService } from '../database/prisma.service';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule] })
class WipeProfessionsModule {}

async function main(): Promise<void> {
  // Deletes unless asked only to count (npm passes it on after `--`: `npm run … -- --dry-run`).
  const confirmed = !process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(WipeProfessionsModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const [professions, characters, drops, snapshots] = await Promise.all([
      prisma.characterProfession.count(),
      prisma.characterProfession.groupBy({ by: ['characterId'] }).then((rows) => rows.length),
      prisma.professionDrop.count(),
      prisma.professionSnapshot.count(),
    ]);
    console.log(
      [
        `Imported professions:            ${professions} (on ${characters} characters)`,
        `Dropped professions remembered:  ${drops}`,
        `Last-import dates:               ${snapshots}`,
      ].join('\n'),
    );
    if (!confirmed) {
      console.log(
        '\nDry run: nothing was deleted. Run again without --dry-run to delete all of it.',
      );
      return;
    }

    const [deleted] = await prisma.$transaction([
      prisma.characterProfession.deleteMany({}),
      prisma.professionDrop.deleteMany({}),
      prisma.professionSnapshot.deleteMany({}),
    ]);
    console.log(`\nDeleted ${deleted.count} professions (and the drops and import dates).`);

    // Posted professions lists: their next run (the worker's, within a minute) posts them empty.
    const lists = await prisma.guildPlugin.updateMany({
      where: { kind: 'PROFESSIONS_POST', enabled: true },
      data: { nextRunAt: new Date() },
    });
    if (lists.count > 0)
      console.log(`${lists.count} Professions List(s) will update within a minute.`);
    console.log('Done.');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error('Wiping the professions failed', error instanceof Error ? error.stack : error);
  process.exit(1);
});
