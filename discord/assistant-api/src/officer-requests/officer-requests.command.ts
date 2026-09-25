import { Injectable } from '@nestjs/common';
import { Command } from '../bot/decorators/command.decorator';
import { Button, Modal } from '../bot/decorators/interaction-handler.decorator';
import {
  getInvokerId,
  getModalValue,
  type ComponentReply,
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
import { parseReplyButtonId } from './officer-request-embeds';

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

  /** The Reply button under an officer's answer in the member's DM: opens a form for the message. */
  @Button('contact-reply')
  async openReplyForm(interaction: DiscordInteraction): Promise<ComponentReply> {
    const target = parseReplyButtonId(interaction.data?.custom_id);
    const invoker = invokerOf(interaction);
    if (!target || !invoker) return MESSAGES.conversationNotFound;
    const refusal = await this.officerRequests.checkCanContinue(
      target.guildId,
      target.publicId,
      invoker.id,
    );
    if (refusal) return refusal;
    return {
      modal: {
        custom_id: interaction.data?.custom_id ?? '',
        title: `Reply to the officers · #${target.publicId}`,
        components: [
          {
            type: 1,
            components: [
              {
                type: 4,
                custom_id: 'message',
                label: 'Your message',
                style: 2,
                min_length: 1,
                max_length: MAX_MESSAGE_LENGTH,
                required: true,
              },
            ],
          },
        ],
      },
    };
  }

  @Modal('contact-reply')
  async sendReplyForm(interaction: DiscordInteraction): Promise<string> {
    const target = parseReplyButtonId(interaction.data?.custom_id);
    const invoker = invokerOf(interaction);
    if (!target || !invoker) return MESSAGES.conversationNotFound;
    const message = (getModalValue(interaction, 'message') ?? '').trim();
    const tooLong = validateMessage(message);
    if (tooLong) return tooLong;
    return this.officerRequests.contact({
      guildId: target.guildId,
      invoker,
      message,
      conversationId: target.publicId,
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
