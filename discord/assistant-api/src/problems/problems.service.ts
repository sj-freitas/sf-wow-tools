import { DiscordAPIError } from '@discordjs/rest';
import { Injectable, Logger } from '@nestjs/common';
import type { ProblemSource } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService } from '../discord/discord-bot.service';
import {
  channelPermissions,
  missingFor,
  PERMISSION_LABELS,
  type ChannelUse,
} from './channel-permissions';

/** A task that can fail: what it is and where it acts. */
export interface ProblemTask {
  guildId: string;
  source: ProblemSource;
  /** The post's, plugin's, event's or honeypot's id. */
  id: string;
  /** For people: "Molten Core sign-ups". */
  label: string;
  /** The channel it acts in, and what it does there (what the bot needs). */
  channelId?: string | null;
  use: ChannelUse;
}

export interface ProblemDto {
  id: string;
  source: ProblemSource;
  sourceId: string;
  label: string;
  channelId: string | null;
  detail: string;
  since: string;
}

/** The Discord errors an officer can fix: missing permission, no access, channel gone. */
const FIXABLE = new Set([50013, 50001, 10003]);

const list = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * Guild problems: what the bot currently can't do for a guild and an officer can fix. A task that
 * fails for such a reason is recorded once (`report`), with what went wrong and how to fix it, and
 * the guild's officers are told once, in the Officer Request Channel (else a DM to the
 * Guild-Assistant holders). It's cleared, with one "Fixed" notice, the next time the task succeeds
 * (`clear`). Other failures (Discord down, a rate limit) are the task's own last error, as before.
 * Never throws: a problem with the problems mustn't stop a task.
 */
@Injectable()
export class ProblemsService {
  private readonly logger = new Logger(ProblemsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
  ) {}

  /** `task` failed with `error`: recorded (and announced once) when an officer can fix it. */
  async report(task: ProblemTask, error: unknown): Promise<void> {
    try {
      if (!(error instanceof DiscordAPIError) || !FIXABLE.has(Number(error.code))) return;
      const detail = await this.describe(task, Number(error.code));
      const key = { guildId: task.guildId, source: task.source, sourceId: task.id };
      const existing = await this.prisma.guildProblem.findUnique({
        where: { guildId_source_sourceId: key },
      });
      if (existing && existing.detail === detail) return; // already known and announced
      await this.prisma.guildProblem.upsert({
        where: { guildId_source_sourceId: key },
        create: { ...key, label: task.label, channelId: task.channelId ?? null, detail },
        update: { label: task.label, channelId: task.channelId ?? null, detail },
      });
      await this.notify(task.guildId, `⚠️ **${task.label}**: ${detail}`);
    } catch (caught) {
      this.logger.warn(
        `Could not record a problem of ${task.source} ${task.id}: ${String(caught)}`,
      );
    }
  }

  /** `task` succeeded: a problem it had is gone (announced once). */
  async clear(task: Pick<ProblemTask, 'guildId' | 'source' | 'id' | 'label'>): Promise<void> {
    try {
      const { count } = await this.prisma.guildProblem.deleteMany({
        where: { guildId: task.guildId, source: task.source, sourceId: task.id },
      });
      if (count > 0) await this.notify(task.guildId, `✅ Fixed: **${task.label}**.`);
    } catch (caught) {
      this.logger.warn(`Could not clear a problem of ${task.source} ${task.id}: ${String(caught)}`);
    }
  }

  /**
   * An officer marked it solved: gone from the list. If it wasn't really fixed, the task's next
   * failure records it again (with a new notice).
   */
  async resolve(guildId: string, problemId: string): Promise<boolean> {
    const { count } = await this.prisma.guildProblem.deleteMany({
      where: { id: problemId, guildId },
    });
    return count > 0;
  }

  async list(guildId: string): Promise<ProblemDto[]> {
    const rows = await this.prisma.guildProblem.findMany({
      where: { guildId },
      orderBy: { since: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      source: row.source,
      sourceId: row.sourceId,
      label: row.label,
      channelId: row.channelId,
      detail: row.detail,
      since: row.since.toISOString(),
    }));
  }

  /**
   * What the bot lacks to do `use` in the channel, by name (empty when nothing). Null when it
   * can't be told (the channel is gone or unreadable): the caller just doesn't warn.
   */
  async missingIn(channelId: string, use: ChannelUse): Promise<string[] | null> {
    try {
      const inputs = await this.bot.channelPermissionInputs(channelId);
      return missingFor(use, channelPermissions(inputs)).map((name) => PERMISSION_LABELS[name]);
    } catch {
      return null;
    }
  }

  /** What went wrong and how to fix it, in plain language. */
  private async describe(task: ProblemTask, code: number): Promise<string> {
    const where = task.channelId ? `<#${task.channelId}>` : 'its channel';
    if (code === 10003) return `${where} no longer exists. Choose another channel for it.`;
    const missing = task.channelId ? await this.missingIn(task.channelId, task.use) : null;
    if (missing && missing.length > 0) {
      const scope = task.use === 'honeypot' ? "the server's settings" : `the settings of ${where}`;
      return `the bot is missing ${list(missing)}. Give the bot's role ${missing.length === 1 ? 'it' : 'them'} in ${scope}.`;
    }
    return code === 50001
      ? `the bot can't see ${where}. Give the bot's role View Channel there.`
      : `the bot is missing a permission in ${where}. Check the bot's role there.`;
  }

  /** To the guild's officers, once: the Officer Request Channel, else a DM to its Guild-Assistants. */
  private async notify(guildId: string, text: string): Promise<void> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { officerRequestChannelId: true },
    });
    if (guild?.officerRequestChannelId) {
      try {
        await this.bot.postMessage(guild.officerRequestChannelId, text);
        return;
      } catch {
        // The officer channel itself may be the problem: tell the Guild-Assistants instead.
      }
    }
    const admins = await this.prisma.guildAccess.findMany({
      where: { guildId, isAdmin: true },
      select: { user: { select: { discordId: true } } },
    });
    for (const { user } of admins) {
      // Once; closed DMs are left at that.
      await this.bot
        .sendDirectMessage(user.discordId, { description: text })
        .catch(() => undefined);
    }
  }
}
