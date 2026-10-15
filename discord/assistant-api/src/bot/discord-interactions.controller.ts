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
import { DiscordBotService } from '../discord/discord-bot.service';
import { CommandRegistryService } from './command-registry.service';
import type {
  ComponentReply,
  DeferredReply,
  DiscordInteraction,
  ReplyMessage,
} from './discord-interaction.types';

/** Discord gives up on an answer after 3 seconds; slower handlers are logged past this. */
const SLOW_MS = 2000;

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
    private readonly bot: DiscordBotService,
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

      const flags = this.commandRegistry.isEphemeral(commandName)
        ? { flags: InteractionResponseFlags.EPHEMERAL }
        : {};
      if (this.commandRegistry.isDeferred(commandName)) {
        this.finishLater(interaction, `/${commandName}`, () =>
          this.runCommand(commandName, interaction),
        );
        return { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: flags };
      }
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: await this.timed(`/${commandName}`, () =>
            this.runCommand(commandName, interaction),
          ),
          ...flags,
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
      reply = await this.timed(`${kind} "${interaction.data?.custom_id}"`, () =>
        this.commandRegistry.executeComponent(kind, interaction),
      );
    } catch (error) {
      this.logger.error(
        `${kind} "${interaction.data?.custom_id}" failed`,
        error instanceof Error ? error.stack : error,
      );
      reply = 'Something went wrong. Please try again.';
    }
    if (reply === null) reply = 'This button is no longer available.';
    if (typeof reply === 'string') {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: reply, flags: InteractionResponseFlags.EPHEMERAL },
      };
    }
    if ('defer' in reply) {
      this.finishLater(interaction, `${kind} "${interaction.data?.custom_id}"`, reply.work);
      return reply.defer === 'update'
        ? { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE }
        : {
            type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL },
          };
    }
    if ('modal' in reply) {
      return {
        type: InteractionResponseType.MODAL,
        data: reply.modal as unknown as Record<string, unknown>,
      };
    }
    if ('update' in reply) {
      return {
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: { ...reply.update, allowed_mentions: { parse: [] } },
      };
    }
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        ...reply.message,
        flags: InteractionResponseFlags.EPHEMERAL,
        allowed_mentions: { parse: [] },
      },
    };
  }

  /**
   * After answering "thinking…": runs the work and puts its result in place of that answer.
   * Failures are logged and shown as a generic message.
   */
  private finishLater(
    interaction: DiscordInteraction,
    label: string,
    work: DeferredReply['work'],
  ): void {
    const { application_id: applicationId, token } = interaction;
    void (async () => {
      let result: string | ReplyMessage;
      try {
        result = await this.timed(label, work, 15_000);
      } catch (error) {
        this.logger.error(`${label} failed`, error instanceof Error ? error.stack : error);
        result = 'Something went wrong. Please try again.';
      }
      if (!applicationId || !token) return;
      const message = typeof result === 'string' ? { content: result } : result;
      try {
        await this.bot.editInteractionResponse(applicationId, token, message as never);
      } catch (error) {
        this.logger.error(`${label}: could not show the answer: ${String(error)}`);
      }
    })();
  }

  /** Runs a handler, logging it when it took longer than Discord would wait. */
  private async timed<T>(label: string, run: () => Promise<T>, limit = SLOW_MS): Promise<T> {
    const started = Date.now();
    try {
      return await run();
    } finally {
      const took = Date.now() - started;
      if (took > limit) this.logger.warn(`${label} took ${took} ms`);
    }
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
