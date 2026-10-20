import { Injectable } from '@nestjs/common';
import { Command } from '../bot/decorators/command.decorator';
import { getStringOption, type DiscordInteraction } from '../bot/discord-interaction.types';
import { ProfessionsService } from './professions.service';

/** Discord's limit for a message, less room for the "and more" line. */
const MAX_LENGTH = 1900;

/**
 * /crafter <item>: who in the guild can craft it (from the professions addon's imports), as their
 * character and their Discord profile (a mention: the reply is private, so nobody is pinged).
 */
@Injectable()
export class ProfessionsCommand {
  constructor(private readonly professions: ProfessionsService) {}

  @Command('crafter', { ephemeral: true })
  async crafter(interaction: DiscordInteraction): Promise<string> {
    if (!interaction.guild_id) return 'This command can only be used inside a server.';
    const query = (getStringOption(interaction, 'item') ?? '').trim();
    if (!query) return 'Which item? `/crafter Copper Rod`, or its id or Wowhead link.';
    const found = await this.professions.findCrafters(interaction.guild_id, query);
    if (!found) return "This server isn't linked to a guild yet.";
    if (found.matches.length === 0) return `Couldn't find a crafter for “${query}”.`;

    let reply = '';
    let shown = 0;
    for (const match of found.matches) {
      const block = [
        `**[${match.name}](<${match.url}>)** · ${match.profession}`,
        ...match.crafters.map(
          (crafter) =>
            `- ${crafter.name}${crafter.discordUserId ? ` · <@${crafter.discordUserId}>` : ''}`,
        ),
      ].join('\n');
      if (reply && reply.length + block.length + 2 > MAX_LENGTH) break;
      reply += (reply ? '\n\n' : '') + block;
      shown++;
    }
    const more = found.more + found.matches.length - shown;
    if (more > 0)
      reply += `\n\n…and ${more} more recipe${more === 1 ? '' : 's'}: be more specific.`;
    return reply;
  }
}
