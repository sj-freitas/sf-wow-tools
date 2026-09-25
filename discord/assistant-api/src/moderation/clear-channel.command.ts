import { Injectable } from '@nestjs/common';
import { Command } from '../bot/decorators/command.decorator';
import {
  getInvokerId,
  getStringOption,
  type DiscordInteraction,
} from '../bot/discord-interaction.types';
import { DiscordBotService } from '../discord/discord-bot.service';
import { ClearChannelService } from './clear-channel.service';

@Injectable()
export class ClearChannelCommand {
  constructor(
    private readonly clearChannel: ClearChannelService,
    private readonly bot: DiscordBotService,
  ) {}

  @Command('clear-channel', { ephemeral: true })
  async clear(interaction: DiscordInteraction): Promise<string> {
    const invokerId = getInvokerId(interaction);
    const { application_id: applicationId, token } = interaction;
    const { reply } = await this.clearChannel.start(
      {
        serverId: interaction.guild_id,
        channelId: getStringOption(interaction, 'channel') ?? interaction.channel_id,
        invoker: invokerId ? { id: invokerId, roleIds: interaction.member?.roles } : null,
      },
      async (text) => {
        if (applicationId && token) await this.bot.editInteractionReply(applicationId, token, text);
      },
    );
    return reply;
  }
}
