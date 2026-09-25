import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import type { Request } from 'express';
import { CommandRegistryService } from './command-registry.service';
import type { ComponentReply, DiscordInteraction } from './discord-interaction.types';

interface InteractionResponse {
  type: InteractionResponseType;
  data?: { content: string; flags?: number } | Record<string, unknown>;
}

/**
 * Discord's HTTP Interactions Endpoint. Configured as the "Interactions
 * Endpoint URL" in the Discord Developer Portal, this receives every slash
 * command invocation as a signed POST instead of over a gateway WebSocket.
 * See https://discord.com/developers/docs/interactions/overview
 */
@Controller('discord')
export class DiscordInteractionsController {
  private readonly logger = new Logger(DiscordInteractionsController.name);
  private readonly publicKey: string;

  constructor(
    configService: ConfigService,
    private readonly commandRegistry: CommandRegistryService,
  ) {
    this.publicKey = configService.getOrThrow<string>('DISCORD_PUBLIC_KEY');
  }

  @Post('interactions')
  @HttpCode(HttpStatus.OK)
  async handleInteraction(
    @Req() req: RawBodyRequest<Request>,
    @Body() interaction: DiscordInteraction,
    @Headers('x-signature-ed25519') signature?: string,
    @Headers('x-signature-timestamp') timestamp?: string,
  ): Promise<InteractionResponse> {
    if (!signature || !timestamp || !req.rawBody) {
      throw new UnauthorizedException('Missing signature headers');
    }

    const isValid = await verifyKey(req.rawBody, signature, timestamp, this.publicKey);
    if (!isValid) {
      throw new UnauthorizedException('Invalid request signature');
    }

    if (interaction.type === InteractionType.PING) {
      return { type: InteractionResponseType.PONG };
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const commandName = interaction.data?.name;
      if (!commandName) {
        throw new BadRequestException('Missing command name');
      }

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: await this.runCommand(commandName, interaction),
          ...(this.commandRegistry.isEphemeral(commandName) && {
            flags: InteractionResponseFlags.EPHEMERAL,
          }),
        },
      };
    }

    if (
      interaction.type === InteractionType.MESSAGE_COMPONENT ||
      interaction.type === InteractionType.MODAL_SUBMIT
    ) {
      return this.handleComponent(interaction);
    }

    throw new BadRequestException(`Unsupported interaction type: ${interaction.type}`);
  }

  /** A button click or a submitted modal. Answers are always private to the user. */
  private async handleComponent(interaction: DiscordInteraction): Promise<InteractionResponse> {
    const kind = interaction.type === InteractionType.MODAL_SUBMIT ? 'modal' : 'button';
    let reply: ComponentReply | null;
    try {
      reply = await this.commandRegistry.executeComponent(kind, interaction);
    } catch (error) {
      this.logger.error(
        `${kind} "${interaction.data?.custom_id}" failed`,
        error instanceof Error ? error.stack : error,
      );
      reply = 'Something went wrong. Please try again.';
    }
    if (reply === null) reply = 'This button is no longer available.';
    if (typeof reply !== 'string') {
      return {
        type: InteractionResponseType.MODAL,
        data: reply.modal as unknown as Record<string, unknown>,
      };
    }
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: reply, flags: InteractionResponseFlags.EPHEMERAL },
    };
  }

  private async runCommand(name: string, interaction: DiscordInteraction): Promise<string> {
    try {
      return await this.commandRegistry.execute(name, interaction);
    } catch (error) {
      this.logger.error(`Command "${name}" failed`, error instanceof Error ? error.stack : error);
      return 'Something went wrong while executing this command.';
    }
  }
}
