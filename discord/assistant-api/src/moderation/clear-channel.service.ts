import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService } from '../discord/discord-bot.service';
import { describeDiscordError } from '../discord/discord-errors';

export const CLEAR_MESSAGES = {
  serverOnly: 'This command can only be used inside a server.',
  notLinked: "This server isn't linked to a guild yet.",
  notOfficer: "You don't have permission to use this command. Only officers can clear a channel.",
  notInServer: 'That channel is not a text channel of this server.',
  busy: 'That channel is already being cleared.',
} as const;

/** Discord only bulk-deletes messages younger than 14 days; a day of margin. */
const BULK_MAX_AGE_MS = 13 * 24 * 60 * 60 * 1000;
const DISCORD_EPOCH = 1_420_070_400_000n;

const ageMs = (messageId: string, now: number): number =>
  now - Number((BigInt(messageId) >> 22n) + DISCORD_EPOCH);

export interface ClearInput {
  serverId: string | undefined;
  /** The channel picked in the command, else the one the command was used in. */
  channelId: string | undefined;
  invoker: { id: string; roleIds?: readonly string[] } | null;
}

export interface ClearStart {
  /** The immediate (private) answer. */
  reply: string;
  /** Resolves when the clearing is over; only set when it was started. */
  done?: Promise<void>;
}

/**
 * `/clear-channel`: deletes every unpinned message of a channel. Officers only (the guild's Officer
 * role in its main server). Deleting takes longer than Discord's 3 seconds to answer, so the
 * command answers at once and the outcome replaces that answer through `report` when it is done.
 */
@Injectable()
export class ClearChannelService {
  private readonly logger = new Logger(ClearChannelService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
  ) {}

  async start(input: ClearInput, report: (text: string) => Promise<void>): Promise<ClearStart> {
    if (!input.serverId || !input.invoker || !input.channelId) {
      return { reply: CLEAR_MESSAGES.serverOnly };
    }
    const guild = await this.prisma.guild.findFirst({
      where: { servers: { some: { discordId: input.serverId } } },
      select: {
        officerRoleId: true,
        servers: { where: { isMain: true }, select: { discordId: true } },
      },
    });
    if (!guild) return { reply: CLEAR_MESSAGES.notLinked };
    if (!(await this.isOfficer(guild, input.serverId, input.invoker))) {
      return { reply: CLEAR_MESSAGES.notOfficer };
    }

    const channels = await this.bot.listTextChannels(input.serverId);
    if (!channels.some((channel) => channel.id === input.channelId)) {
      return { reply: CLEAR_MESSAGES.notInServer };
    }
    if (this.running.has(input.channelId)) return { reply: CLEAR_MESSAGES.busy };

    const channelId = input.channelId;
    this.running.add(channelId);
    const done = this.clear(channelId)
      .then((deleted) =>
        report(
          `Cleared <#${channelId}>: ${deleted} message${deleted === 1 ? '' : 's'} deleted. Pinned messages were kept.`,
        ),
      )
      .catch((error: unknown) => {
        this.logger.warn(`Could not clear ${channelId}: ${describeDiscordError(error)}`);
        return report(
          `Could not finish clearing <#${channelId}>: ${describeDiscordError(error)}. Make sure the bot can view the channel, read its history and has Manage Messages there.`,
        );
      })
      .catch(() => undefined) // the reply expired or was deleted: nothing left to tell
      .finally(() => this.running.delete(channelId));

    return {
      reply: `Clearing <#${channelId}>… this can take a while for a big channel. I'll update this message when it is done.`,
      done,
    };
  }

  /** Walks the channel from the newest message back, deleting what is not pinned. */
  private async clear(channelId: string): Promise<number> {
    let deleted = 0;
    let before: string | undefined;
    for (;;) {
      const page = await this.bot.listMessages(channelId, before);
      if (page.length === 0) return deleted;
      before = page[page.length - 1].id;

      const now = Date.now();
      const doomed = page.filter((message) => !message.pinned);
      const recent = doomed.filter((m) => ageMs(m.id, now) < BULK_MAX_AGE_MS).map((m) => m.id);
      const old = doomed.filter((m) => ageMs(m.id, now) >= BULK_MAX_AGE_MS).map((m) => m.id);

      if (recent.length >= 2) {
        await this.bot.bulkDeleteMessages(channelId, recent);
        deleted += recent.length;
      } else {
        old.push(...recent);
      }
      for (const id of old) {
        try {
          await this.bot.deleteMessage(channelId, id);
          deleted++;
        } catch (error) {
          // Already gone, or a system message Discord does not let anyone delete.
          this.logger.debug(`Skipped message ${id}: ${describeDiscordError(error)}`);
        }
      }
    }
  }

  private async isOfficer(
    guild: { officerRoleId: string | null; servers: { discordId: string }[] },
    serverId: string,
    invoker: { id: string; roleIds?: readonly string[] },
  ): Promise<boolean> {
    const main = guild.servers[0]?.discordId;
    if (!guild.officerRoleId || !main) return false;
    const roles =
      main === serverId && invoker.roleIds
        ? invoker.roleIds
        : await this.bot.fetchMemberRoles(main, invoker.id);
    return roles.includes(guild.officerRoleId);
  }
}
