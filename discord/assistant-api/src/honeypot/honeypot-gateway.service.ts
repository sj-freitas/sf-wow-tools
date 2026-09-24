import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Events, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { HoneypotEnforcerService } from './honeypot-enforcer.service';

/**
 * The bot's live connection to Discord, used only to notice posts in honeypot channels.
 * Needs no privileged intent: message text is not read, only who posted where.
 */
@Injectable()
export class HoneypotGatewayService {
  private readonly logger = new Logger(HoneypotGatewayService.name);
  private client: Client | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly enforcer: HoneypotEnforcerService,
  ) {}

  async start(): Promise<void> {
    if (this.client) return;
    await this.enforcer.start();

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
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
