/**
 * Deletes every character, for the game's release: whatever was registered during testing goes,
 * and everyone registers their real characters again. Run once, with `npm run characters:wipe`
 * (a dry run: it only counts) and then `npm run characters:wipe -- --yes`. A one-off CLI script,
 * like `commands:register`; it needs DATABASE_URL and DISCORD_TOKEN.
 *
 * Deleted with the characters (all by the database's cascades): every guild's roster
 * (`character_guild_memberships`), bios and their images, Officer notes and their images, which
 * attributes characters have, and sign-ups made with a character.
 *
 * Kept: players (Discord accounts), guilds and their settings, the guild attributes themselves,
 * posts, events, and sign-ups without a character (absent without one, and every sign-up to a
 * members event, which is the person, not a character: their character, if any, is just unset).
 *
 * Nothing it leaves behind is new to the app: a sign-up deleted here is the same as someone
 * withdrawing (assignments and the setup already skip people no longer signed up), and an empty
 * roster is a new guild's. The sign-up posts of events that lost sign-ups are edited afterwards
 * so they don't list people who are no longer signed up; roster posts (`{{roster …}}` tags)
 * update by themselves within a minute, as on any roster change. A running API keeps working;
 * open backoffice pages show the old roster until they are reloaded.
 */
import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotModule } from '../discord/discord-bot.module';
import { SignupCoreModule } from '../signup/signup-core.module';
import { SignupEventsService } from '../signup/signup-events.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    DiscordBotModule,
    SignupCoreModule,
  ],
})
class WipeCharactersModule {}

async function main(): Promise<void> {
  const confirmed = process.argv.includes('--yes');
  const app = await NestFactory.createApplicationContext(WipeCharactersModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);

    const [characters, memberships, notes, signups] = await Promise.all([
      prisma.character.count(),
      prisma.characterGuildMembership.count(),
      prisma.characterOfficerNote.count(),
      prisma.signupEntry.count({
        where: { characterId: { not: null }, event: { kind: 'CHARACTERS' } },
      }),
    ]);
    console.log(
      [
        `Characters:                     ${characters}`,
        `Roster entries (all guilds):    ${memberships}`,
        `Officer notes:                  ${notes}`,
        `Sign-ups made with a character: ${signups}`,
      ].join('\n'),
    );
    if (!confirmed) {
      console.log('\nDry run: nothing was deleted. Run again with --yes to delete all of it.');
      return;
    }

    // The posted, not archived events that lose sign-ups: their posts are edited afterwards.
    const affected = await prisma.signupEvent.findMany({
      where: {
        kind: 'CHARACTERS',
        archivedAt: null,
        messageId: { not: null },
        entries: { some: { characterId: { not: null } } },
      },
      select: { id: true },
    });

    const deleted = await prisma.$transaction(async (tx) => {
      // A members event's sign-up is the person: it stays, only without a character.
      await tx.signupEntry.updateMany({
        where: { characterId: { not: null }, event: { kind: 'MEMBERS' } },
        data: { characterId: null },
      });
      return (await tx.character.deleteMany({})).count;
    });
    console.log(`\nDeleted ${deleted} characters.`);

    if (affected.length > 0) {
      console.log(`Updating the posts of ${affected.length} event(s)…`);
      const events = app.get(SignupEventsService);
      for (const { id } of affected) {
        events.refresh(id);
        await events.settled(id);
      }
    }
    console.log('Done.');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error('Wiping the characters failed', error instanceof Error ? error.stack : error);
  process.exit(1);
});
