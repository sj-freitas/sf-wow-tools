/**
 * Pushes the commands defined in `commands.json` (the source of truth) to
 * Discord's API. Run with `npm run commands:register`. This is a one-off
 * CLI script, not part of the running server — it isn't invoked at
 * runtime, only when `commands.json` changes.
 *
 * If DISCORD_GUILD_ID is set, commands are registered to that single guild
 * (near-instant propagation, good for development). Otherwise they are
 * registered globally (can take up to an hour to propagate).
 */
import 'dotenv/config';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import commands from './commands.json';

async function main(): Promise<void> {
  const token = requireEnv('DISCORD_TOKEN');
  const applicationId = requireEnv('DISCORD_APPLICATION_ID');
  const guildId = process.env.DISCORD_GUILD_ID;

  const rest = new REST().setToken(token);
  const route = guildId
    ? Routes.applicationGuildCommands(applicationId, guildId)
    : Routes.applicationCommands(applicationId);

  const result = (await rest.put(route, { body: commands })) as { id: string; name: string }[];

  console.log(
    `Registered ${result.length} command(s) ${guildId ? `to guild ${guildId}` : 'globally'}.`,
  );
  // The ids are what makes a command clickable in a message: </name:id>.
  for (const command of result) console.log(`  /${command.name}  ${command.id}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

main().catch((error: unknown) => {
  console.error('Failed to register commands', error);
  process.exit(1);
});
