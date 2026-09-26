import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma, ScheduledTask } from '@prisma/client';
import { formatCharacterName } from '../characters/character-name';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService } from '../discord/discord-bot.service';
import { describeDiscordError, isDiscordError, UNKNOWN_MESSAGE } from '../discord/discord-errors';
import {
  hashReactors,
  parseDynamicTokens,
  renderContent,
  trackingKey,
  type DynamicToken,
  type Reactor,
  type ReactorFormat,
} from './dynamic-content';
import { embedsShown, type PostConfig, type PostState } from './post-task';

const isLive = (state: PostState): boolean => Boolean(state.messageId) && !state.messageDeleted;

/** Which post each tag's `ref` stands for. */
export type SourceMap = Map<string, string>;

/** Who reacted, by tracking key (see `trackingKey`). */
export type PeopleByKey = Map<string, Reactor[]>;

/**
 * The dynamic features of posts: `{{reactions post=… emoji=… show=…}}` in a post's text is
 * replaced by the people who reacted. Saving a post keeps its tracking rows in line with its text;
 * the worker then re-reads the reactions every minute and edits the Discord message when they
 * changed. A cheap hash of who reacted tells whether anything did.
 */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
  ) {}

  /**
   * Finds the post each token points at: by id, by name (case does not matter) or `self`. Throws
   * for a post that does not exist in this guild, or a name that two posts share, so a wrong tag is
   * refused on save. `selfId` is unknown while a post is being created; its own tags wait.
   */
  async resolveSources(
    guildId: string,
    tokens: readonly DynamicToken[],
    selfId?: string,
  ): Promise<SourceMap> {
    const sources: SourceMap = new Map();
    for (const token of tokens) {
      if (sources.has(token.ref)) continue;
      if (token.ref === 'self') {
        if (selfId) sources.set(token.ref, selfId);
        continue;
      }
      if (token.ref.startsWith('id:')) {
        const id = token.ref.slice(3);
        const found = await this.prisma.scheduledTask.findFirst({
          where: { id, guildId },
          select: { id: true },
        });
        if (!found) {
          throw new BadRequestException(
            `There is no post with the id ${id} in this guild (copy a post's id from the Posts page).`,
          );
        }
        sources.set(token.ref, id);
        continue;
      }
      const matches = await this.prisma.scheduledTask.findMany({
        where: { guildId, name: { equals: token.label.trim(), mode: 'insensitive' } },
        select: { id: true },
      });
      if (matches.length === 0) {
        throw new BadRequestException(`There is no post named "${token.label}" in this guild.`);
      }
      if (matches.length > 1) {
        throw new BadRequestException(
          `${matches.length} posts are named "${token.label}": rename one, or use its id (Copy ID on the Posts page).`,
        );
      }
      sources.set(token.ref, matches[0].id);
    }
    return sources;
  }

  /**
   * The posts a saved post's tags point at, for the worker and for posting: what was found when
   * the post was saved (so renaming the other post does not break this one), else looked up now.
   */
  async sourceMap(
    taskId: string,
    guildId: string,
    tokens: readonly DynamicToken[],
  ): Promise<SourceMap> {
    const sources: SourceMap = new Map();
    for (const row of await this.prisma.postTracking.findMany({ where: { taskId } })) {
      sources.set(row.postRef, row.sourceTaskId);
    }
    const missing = tokens.filter((token) => !sources.has(token.ref));
    if (missing.length > 0) {
      try {
        for (const [ref, id] of await this.resolveSources(guildId, missing, taskId)) {
          sources.set(ref, id);
        }
      } catch {
        // A tag that points nowhere shows as nobody.
      }
    }
    return sources;
  }

  /**
   * Reads, from Discord, who reacted for every token now. A post that is not in Discord (yet)
   * has no reactions. Other Discord errors are thrown: better than showing wrong people.
   */
  async fetchPeople(
    guildId: string,
    tokens: readonly DynamicToken[],
    sources: SourceMap,
  ): Promise<PeopleByKey> {
    const people: PeopleByKey = new Map();
    const posts = new Map<string, ScheduledTask | null>();
    for (const token of tokens) {
      const key = trackingKey(token);
      if (people.has(key)) continue;
      const sourceId = sources.get(token.ref);
      if (sourceId && !posts.has(sourceId)) {
        posts.set(
          sourceId,
          await this.prisma.scheduledTask.findUnique({ where: { id: sourceId } }),
        );
      }
      const reactors = await this.readReactors(sourceId ? posts.get(sourceId) : null, token.emoji);
      people.set(
        key,
        token.format === 'mainNames' ? await this.withMainNames(guildId, reactors) : reactors,
      );
    }
    return people;
  }

  /** Who reacted to a post's message with an emoji, without the bot itself. */
  async readReactors(source: ScheduledTask | null | undefined, emoji: string): Promise<Reactor[]> {
    const state = source ? (source.state as PostState) : {};
    if (!source || !isLive(state) || !state.channelId || !state.messageId) return [];
    try {
      const [users, botId] = await Promise.all([
        this.bot.getReactionUsers(state.channelId, state.messageId, emoji),
        this.bot.getBotUserId(),
      ]);
      return users.filter((user) => user.id !== botId);
    } catch (error) {
      // The message (or the emoji's reactions) is gone: nobody reacted.
      if (isDiscordError(error, UNKNOWN_MESSAGE) || isDiscordError(error, UNKNOWN_EMOJI)) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Swaps each person's Discord name for the names of their main characters in the guild (several
   * mains are joined with " / "). Someone with no main character keeps their Discord name.
   */
  async withMainNames(guildId: string, reactors: readonly Reactor[]): Promise<Reactor[]> {
    if (reactors.length === 0) return [];
    const players = await this.prisma.player.findMany({
      where: { guildId, discordUserId: { in: reactors.map((reactor) => reactor.id) } },
      select: {
        discordUserId: true,
        characters: {
          where: { isMain: true },
          orderBy: { createdAt: 'asc' },
          select: { firstName: true, lastName: true },
        },
      },
    });
    const mains = new Map(
      players.map((player) => [
        player.discordUserId,
        player.characters.map((character) => formatCharacterName(character)).join(' / '),
      ]),
    );
    return reactors.map((reactor) => ({
      id: reactor.id,
      name: mains.get(reactor.id) || reactor.name,
    }));
  }

  /**
   * Makes the post's tracking rows match its text: rows for tags that are gone are removed, rows
   * for new tags are added. `people` (from `fetchPeople`) seeds the rows so the worker does not
   * find a "change" straight away.
   */
  async syncTracking(
    taskId: string,
    tokens: readonly DynamicToken[],
    sources: SourceMap,
    people?: PeopleByKey,
  ): Promise<void> {
    const wanted = new Map(tokens.map((token) => [trackingKey(token), token]));
    const rows = await this.prisma.postTracking.findMany({ where: { taskId } });
    const rowKey = (row: { postRef: string; emoji: string; type: string }) =>
      trackingKey({ ref: row.postRef, emoji: row.emoji, format: row.type as ReactorFormat });
    const have = new Map(rows.map((row) => [rowKey(row), row]));

    const stale = rows.filter((row) => !wanted.has(rowKey(row)));
    if (stale.length > 0) {
      await this.prisma.postTracking.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
    }
    for (const [key, token] of wanted) {
      const sourceId = sources.get(token.ref);
      if (!sourceId) continue;
      const existing = have.get(key);
      if (existing) {
        // The tag may now point at another post (the name was moved): follow it.
        if (existing.sourceTaskId !== sourceId) {
          await this.prisma.postTracking.update({
            where: { id: existing.id },
            data: { sourceTaskId: sourceId, lastHash: null },
          });
        }
        continue;
      }
      const users = people?.get(key);
      await this.prisma.postTracking.create({
        data: {
          taskId,
          sourceTaskId: sourceId,
          postRef: token.ref,
          emoji: token.emoji,
          type: token.format,
          ...(users
            ? {
                lastHash: hashReactors(users),
                lastUsers: users as unknown as Prisma.InputJsonValue,
                checkedAt: new Date(),
              }
            : {}),
        },
      });
    }
  }

  /** One pass of the worker: refresh every live post that has dynamic features. Never throws. */
  async refreshDue(): Promise<number> {
    let edited = 0;
    try {
      const rows = await this.prisma.postTracking.findMany({
        include: { task: true, sourceTask: true },
        orderBy: [{ taskId: 'asc' }, { createdAt: 'asc' }],
      });
      const changedTasks = new Map<string, ScheduledTask>();
      for (const row of rows) {
        if (!isLive(row.task.state as PostState)) continue;
        try {
          const read = await this.readReactors(row.sourceTask, row.emoji);
          // Main characters are part of what is compared, so a new main updates the post too.
          const reactors =
            row.type === 'mainNames' ? await this.withMainNames(row.task.guildId, read) : read;
          const hash = hashReactors(reactors);
          if (hash === row.lastHash) continue;
          await this.prisma.postTracking.update({
            where: { id: row.id },
            data: {
              lastHash: hash,
              lastUsers: reactors as unknown as Prisma.InputJsonValue,
              checkedAt: new Date(),
            },
          });
          row.lastUsers = reactors as unknown as Prisma.JsonValue;
          changedTasks.set(row.taskId, row.task);
        } catch (error) {
          this.logger.warn(`Could not read reactions for post ${row.taskId}: ${String(error)}`);
        }
      }
      for (const task of changedTasks.values()) {
        try {
          if (
            await this.rerender(
              task,
              rows.filter((row) => row.taskId === task.id),
            )
          )
            edited++;
        } catch (error) {
          this.logger.warn(`Could not update post ${task.id}: ${describeDiscordError(error)}`);
        }
      }
    } catch (error) {
      this.logger.error(`Refreshing tracked posts failed: ${String(error)}`);
    }
    return edited;
  }

  /** Writes the post's text with the latest people into Discord, if that changes the message. */
  private async rerender(
    task: ScheduledTask,
    rows: { postRef: string; emoji: string; type: string; lastUsers: Prisma.JsonValue }[],
  ): Promise<boolean> {
    const config = task.config as unknown as PostConfig;
    const state = task.state as PostState;
    const tokens = parseDynamicTokens(config.content);
    const people: PeopleByKey = new Map(
      rows.map((row) => [
        trackingKey({ ref: row.postRef, emoji: row.emoji, format: row.type as ReactorFormat }),
        row.lastUsers as unknown as Reactor[],
      ]),
    );
    const rendered = renderContent(config.content, tokens, people);
    if (rendered === state.renderedContent || !state.channelId || !state.messageId) return false;
    try {
      await this.bot.editMessage(state.channelId, state.messageId, rendered, {
        suppressEmbeds: !embedsShown(config),
        quiet: true,
      });
    } catch (error) {
      if (isDiscordError(error, UNKNOWN_MESSAGE)) {
        await this.prisma.scheduledTask.update({
          where: { id: task.id },
          data: { state: { ...state, messageDeleted: true } },
        });
        return false;
      }
      throw error;
    }
    await this.prisma.scheduledTask.update({
      where: { id: task.id },
      data: { state: { ...state, renderedContent: rendered } },
    });
    return true;
  }
}

/** Discord's "Unknown Emoji" error code. */
const UNKNOWN_EMOJI = 10014;
