import { Injectable } from '@nestjs/common';
import { Command } from '../bot/decorators/command.decorator';
import {
  getInvokerId,
  getNumberOption,
  getOptionalBooleanOption,
  getStringOption,
  type DiscordInteraction,
} from '../bot/discord-interaction.types';
import {
  MAX_MESSAGE_LENGTH,
  MESSAGES,
  OfficerRequestsService,
  type Invoker,
} from './officer-requests.service';

/** The two Discord commands of the officer contact flow. All answers are private (ephemeral). */
@Injectable()
export class OfficerRequestsCommand {
  constructor(private readonly officerRequests: OfficerRequestsService) {}

  @Command('contact-officer', { ephemeral: true })
  async contact(interaction: DiscordInteraction): Promise<string> {
    const invoker = invokerOf(interaction);
    if (!interaction.guild_id || !invoker) return MESSAGES.serverOnly;
    const message = (getStringOption(interaction, 'message') ?? '').trim();
    const tooLong = validateMessage(message);
    if (tooLong) return tooLong;

    return this.officerRequests.contact({
      serverId: interaction.guild_id,
      invoker,
      message,
      anonymous: getOptionalBooleanOption(interaction, 'anonymous'),
      conversationId: getNumberOption(interaction, 'conversation-id'),
    });
  }

  @Command('contact-officer-reply', { ephemeral: true })
  async reply(interaction: DiscordInteraction): Promise<string> {
    const invoker = invokerOf(interaction);
    if (!interaction.guild_id || !invoker) return MESSAGES.serverOnly;
    const message = (getStringOption(interaction, 'message') ?? '').trim();
    const tooLong = validateMessage(message);
    if (tooLong) return tooLong;
    const conversationId = getNumberOption(interaction, 'conversation-id');
    if (conversationId === undefined) return 'Give the conversation ID to reply to.';

    return this.officerRequests.reply({
      serverId: interaction.guild_id,
      invoker,
      conversationId,
      message,
    });
  }
}

function validateMessage(message: string): string | null {
  if (message === '') return 'Write a message first.';
  if (message.length > MAX_MESSAGE_LENGTH) {
    return `That message is too long (${message.length} characters). The limit is ${MAX_MESSAGE_LENGTH}.`;
  }
  return null;
}

function invokerOf(interaction: DiscordInteraction): Invoker | null {
  const id = getInvokerId(interaction);
  if (!id) return null;
  const user = interaction.member?.user ?? interaction.user;
  return {
    id,
    name: interaction.member?.nick ?? user?.global_name ?? user?.username ?? 'Unknown',
    roleIds: interaction.member?.roles,
  };
}
