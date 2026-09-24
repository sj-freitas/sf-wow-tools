import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService } from '../discord/discord-bot.service';
import { describeDiscordError } from '../discord/discord-errors';
import { messageUrl } from '../tasks/post-task';
import { BAN_DELETE_SECONDS, decideHoneypot } from './honeypot-rules';

/** A message posted in a server, reduced to what the honeypot needs (no discord.js types). */
export interface PostedMessage {
  serverId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  authorUsername: string;
  authorIsBot: boolean;
  isServerOwner: boolean;
  isAdministrator: boolean;
  /** The author's role ids in `serverId`, when the gateway included them. */
  roleIds: readonly string[] | null;
}

interface ActiveHoneypot {
  id: string;
  name: string;
  testMode: boolean;
  serverId: string;
  logChannelId: string;
  officerRoleId: string | null;
  mainServerId: string | null;
}

const REFRESH_MS = 30 * 1000;
const DEDUPE_MS = 5 * 60 * 1000;

/**
 * Decides and acts when someone posts in a honeypot channel. Honeypots are read from the
 * database every 30 seconds, so a new or changed honeypot is picked up without a restart.
 * In test mode nothing is banned: what would have happened goes to the log channel.
 */
@Injectable()
export class HoneypotEnforcerService {
  private readonly logger = new Logger(HoneypotEnforcerService.name);
  private byChannel = new Map<string, ActiveHoneypot>();
  private timer: NodeJS.Timeout | null = null;
  /** userId -> when we last acted, so a spammer does not flood the log channel. */
  private readonly recent = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
  ) {}

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<void> {
    try {
      const honeypots = await this.prisma.honeypot.findMany({
        where: { enabled: true },
        include: {
          guild: {
            select: {
              officerRoleId: true,
              servers: { where: { isMain: true }, select: { discordId: true } },
            },
          },
        },
      });
      this.byChannel = new Map(
        honeypots.map((honeypot) => [
          honeypot.channelId,
          {
            id: honeypot.id,
            name: honeypot.name,
            testMode: honeypot.testMode,
            serverId: honeypot.discordServerId,
            logChannelId: honeypot.logChannelId,
            officerRoleId: honeypot.guild.officerRoleId,
            mainServerId: honeypot.guild.servers[0]?.discordId ?? null,
          },
        ]),
      );
    } catch (error) {
      this.logger.error(`Could not load honeypots: ${String(error)}`);
    }
  }

  /** Whether a channel is currently a honeypot (the gateway listener filters on this). */
  isHoneypot(channelId: string): boolean {
    return this.byChannel.has(channelId);
  }

  async handle(message: PostedMessage): Promise<void> {
    const honeypot = this.byChannel.get(message.channelId);
    if (!honeypot) return;
    if (message.authorIsBot) return; // bots, including this one, are never touched

    const botUserId = await this.bot.getBotUserId();
    const mainServerRoleIds =
      honeypot.mainServerId === message.serverId && message.roleIds
        ? message.roleIds
        : honeypot.mainServerId
          ? await this.bot.fetchMemberRoles(honeypot.mainServerId, message.authorId)
          : [];

    const decision = decideHoneypot(
      {
        userId: message.authorId,
        botUserId,
        isBot: message.authorIsBot,
        isServerOwner: message.isServerOwner,
        isAdministrator: message.isAdministrator,
        mainServerRoleIds,
      },
      honeypot.officerRoleId,
      honeypot.testMode,
    );
    if (decision.action === 'IGNORE' || decision.action === 'EXEMPT') return;

    const last = this.recent.get(message.authorId);
    if (last && Date.now() - last < DEDUPE_MS) return;
    this.recent.set(message.authorId, Date.now());

    const link = messageUrl(message.serverId, message.channelId, message.messageId);
    const who = `<@${message.authorId}> (${message.authorUsername}, ${message.authorId})`;

    if (decision.action === 'WOULD_BAN') {
      await this.record(honeypot, message, 'WOULD_BAN', null);
      await this.log(
        honeypot,
        `🧪 **Test mode.** Would ban ${who} for posting in <#${message.channelId}> (${link}) and delete their messages from the last hour. Nothing was done.`,
      );
      return;
    }

    try {
      await this.bot.banMember(message.serverId, message.authorId, {
        deleteMessageSeconds: BAN_DELETE_SECONDS,
        reason: `Guild Assistant honeypot: posted in #${honeypot.name}`,
      });
      await this.record(honeypot, message, 'BANNED', null);
      await this.log(
        honeypot,
        `🔨 Banned ${who} for posting in <#${message.channelId}>. Their messages from the last hour were deleted.`,
      );
    } catch (error) {
      const reason = describeDiscordError(error);
      await this.record(honeypot, message, 'FAILED', reason);
      await this.log(
        honeypot,
        `⚠️ Could not ban ${who} for posting in <#${message.channelId}> (${link}): ${reason}`,
      );
    }
  }

  private async record(
    honeypot: ActiveHoneypot,
    message: PostedMessage,
    action: 'WOULD_BAN' | 'BANNED' | 'FAILED',
    error: string | null,
  ): Promise<void> {
    try {
      await this.prisma.honeypotEvent.create({
        data: {
          honeypotId: honeypot.id,
          discordUserId: message.authorId,
          username: message.authorUsername,
          messageId: message.messageId,
          action,
          error,
        },
      });
    } catch (error_) {
      this.logger.error(`Could not record honeypot event: ${String(error_)}`);
    }
  }

  private async log(honeypot: ActiveHoneypot, text: string): Promise<void> {
    try {
      await this.bot.postQuietMessage(honeypot.logChannelId, text);
    } catch (error) {
      this.logger.warn(`Could not write to the log channel: ${String(error)}`);
    }
  }
}
