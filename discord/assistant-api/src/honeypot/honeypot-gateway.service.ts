import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Events, GatewayIntentBits, Partials, PermissionFlagsBits } from 'discord.js';
import { HoneypotEnforcerService } from './honeypot-enforcer.service';

/**
 * The bot's live connection to Discord: notices posts in honeypot channels, and tells whoever
 * asked (`onMessageDeleted`) when a message is deleted — event sign-ups archive an event whose
 * post was deleted. Needs no privileged intent: message text is not read, only who posted where.
 */
@Injectable()
export class HoneypotGatewayService {
  private readonly logger = new Logger(HoneypotGatewayService.name);
  private client: Client | null = null;
  private readonly deletedListeners: ((messageId: string) => void)[] = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly enforcer: HoneypotEnforcerService,
  ) {}

  /** Runs `listener` with the id of every message deleted where the bot can see. */
  onMessageDeleted(listener: (messageId: string) => void): void {
    this.deletedListeners.push(listener);
  }

  private messageDeleted(messageId: string): void {
    for (const listener of this.deletedListeners) {
      try {
        listener(messageId);
      } catch (error) {
        this.logger.error(`Message deletion handling failed: ${String(error)}`);
      }
    }
  }

  async start(): Promise<void> {
    if (this.client) return;
    await this.enforcer.start();

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
      // Without this, deleting a message the bot hasn't cached (posted before it last started)
      // would go unreported.
      partials: [Partials.Message],
    });
    client.once(Events.ClientReady, (ready) =>
      this.logger.log(`Honeypot listener connected as ${ready.user.tag}`),
    );
    client.on(Events.MessageCreate, (message) => {
      if (!message.guildId || !this.enforcer.isHoneypot(message.channelId)) return;
      void this.enforcer
        .handle({
          serverId: message.guildId,
          channelId: message.channelId,
          messageId: message.id,
          authorId: message.author.id,
          authorUsername: message.author.username,
          authorIsBot: message.author.bot || message.webhookId !== null,
          isServerOwner: message.guild?.ownerId === message.author.id,
          isAdministrator:
            message.member?.permissions.has(PermissionFlagsBits.Administrator) ?? false,
          roleIds: message.member ? [...message.member.roles.cache.keys()] : null,
        })
        .catch((error: unknown) => this.logger.error(`Honeypot handling failed: ${String(error)}`));
    });
    client.on(Events.MessageDelete, (message) => this.messageDeleted(message.id));
    client.on(Events.MessageBulkDelete, (messages) =>
      messages.forEach((message) => this.messageDeleted(message.id)),
    );
    client.on(Events.Error, (error) => this.logger.error(`Gateway error: ${error.message}`));

    await client.login(this.configService.getOrThrow<string>('DISCORD_TOKEN'));
    this.client = client;
  }

  async stop(): Promise<void> {
    this.enforcer.stop();
    await this.client?.destroy();
    this.client = null;
  }
}
