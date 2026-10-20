import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, Role, SignupEventKind, SignupLockMode } from '@prisma/client';
import { formatCharacterName } from '../characters/character-name';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService } from '../discord/discord-bot.service';
import { describeDiscordError, isDiscordError, UNKNOWN_MESSAGE } from '../discord/discord-errors';
import { ClassEmojiService, emojiText } from '../discord/class-emojis.service';
import { EVENT_KINDS } from './event-kinds';

/** Each role's icon file (`role-icons/<name>.png`). */
const ROLE_ICON_NAME: Record<Role, string> = {
  TANK: 'Tank',
  HEALER: 'Healer',
  MELEE_DPS: 'Melee',
  RANGED_DPS: 'Ranged',
};
import { addCharacterUrl, eventPageUrl, siteOrigin } from './signup-links';
import {
  renderEventMessage,
  renderSetupMessage,
  type Look,
  type EntryView,
  type EventView,
} from './signup-messages';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_TITLE_LENGTH,
  isClosed,
} from './signup-rules';

/** What every sign-up feature needs to know about the guild. */
export const GUILD_SELECT = {
  id: true,
  name: true,
  gameVersion: true,
  region: true,
  realm: true,
  faction: true,
  officerRoleId: true,
  servers: { select: { discordId: true, isMain: true } },
} satisfies Prisma.GuildSelect;
export type SignupGuild = Prisma.GuildGetPayload<{ select: typeof GUILD_SELECT }>;

export const ENTRY_INCLUDE = {
  character: { select: { firstName: true, lastName: true, class: true } },
} satisfies Prisma.SignupEntryInclude;
export type EntryRow = Prisma.SignupEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

export const EVENT_INCLUDE = {
  entries: { include: ENTRY_INCLUDE, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SignupEventInclude;
export type EventRow = Prisma.SignupEventGetPayload<{ include: typeof EVENT_INCLUDE }>;

export interface EventInput {
  /** Only read when creating: an event's kind never changes. Left out: characters. */
  kind?: SignupEventKind;
  /**
   * When to post it: left out (or a time already passed) posts it at once. Only for an event that
   * isn't posted yet: creating one, or changing a scheduled one's time.
   */
  publishAt?: Date;
  title: string;
  description: string;
  /** Where: a dungeon or raid, or any place. Optional (empty). */
  location?: string;
  startsAt: Date;
  timezone: string;
}

export interface EventChannel {
  serverId: string;
  channelId: string;
}

export const toEntryView = (entry: EntryRow): EntryView => ({
  id: entry.id,
  discordUserId: entry.discordUserId,
  discordName: entry.discordName,
  characterName: entry.character ? formatCharacterName(entry.character) : null,
  characterClass: entry.character?.class ?? null,
  role: entry.role,
  status: entry.status,
  groupNumber: entry.groupNumber,
  groupSlot: entry.groupSlot,
  assist: entry.assist,
});

/**
 * Events and their Discord posts: creating, editing, locking and deleting them, and keeping the
 * sign-up post and the raid setup post in step with the database. Needs only the database and the
 * bot, so the worker uses it too.
 */
@Injectable()
export class SignupEventsService {
  private readonly logger = new Logger(SignupEventsService.name);
  readonly origin: string;
  /** Per event: the refresh running now, and whether another one was asked for meanwhile. */
  private readonly refreshing = new Map<string, Promise<void>>();
  private readonly refreshAgain = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordBotService,
    private readonly classEmojis: ClassEmojiService,
    config: ConfigService,
  ) {
    this.origin = siteOrigin(config);
  }

  async findGuild(guildId: string): Promise<SignupGuild> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: GUILD_SELECT,
    });
    if (!guild) throw new NotFoundException('Guild not found');
    return guild;
  }

  findGuildOfServer(serverId: string): Promise<SignupGuild | null> {
    return this.prisma.guild.findFirst({
      where: { servers: { some: { discordId: serverId } } },
      select: GUILD_SELECT,
    });
  }

  async getSettings(guildId: string) {
    const settings = await this.prisma.signupSettings.findUnique({ where: { guildId } });
    return {
      channelServerId: settings?.channelServerId ?? null,
      channelId: settings?.channelId ?? null,
      eventCreatorRoleId: settings?.eventCreatorRoleId ?? null,
      eventCreatorRoleName: settings?.eventCreatorRoleName ?? null,
    };
  }

  /** The event, with everyone's sign-up; 404 unless it is one of the guild's. */
  async load(guildId: string, eventId: string): Promise<EventRow> {
    const event = await this.prisma.signupEvent.findFirst({
      where: { id: eventId, guildId },
      include: EVENT_INCLUDE,
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  /**
   * Just enough to answer a button within Discord's 3 seconds, in one small query: whether the
   * event is open, and whether this person already signed up with a character.
   */
  async peek(
    eventId: string,
    discordUserId: string,
  ): Promise<{
    kind: SignupEventKind;
    lockMode: SignupLockMode;
    startsAt: Date;
    archivedAt: Date | null;
    hasCharacter: boolean;
  } | null> {
    const event = await this.prisma.signupEvent.findUnique({
      where: { id: eventId },
      select: {
        kind: true,
        lockMode: true,
        startsAt: true,
        archivedAt: true,
        entries: { where: { discordUserId }, select: { characterId: true } },
      },
    });
    if (!event) return null;
    return {
      kind: event.kind,
      lockMode: event.lockMode,
      startsAt: event.startsAt,
      archivedAt: event.archivedAt,
      hasCharacter: event.entries.some((entry) => entry.characterId !== null),
    };
  }

  /** `load`, addressed by the event alone (Discord buttons carry only its id). */
  async loadById(eventId: string): Promise<EventRow | null> {
    return this.prisma.signupEvent.findUnique({ where: { id: eventId }, include: EVENT_INCLUDE });
  }

  eventView(
    guild: SignupGuild,
    event: Pick<
      EventRow,
      | 'id'
      | 'title'
      | 'description'
      | 'location'
      | 'startsAt'
      | 'lockMode'
      | 'archivedAt'
      | 'publishAt'
      | 'createdByName'
      | 'createdByDiscordId'
      | 'leaderDiscordUserId'
      | 'masterLooterDiscordUserId'
      | 'kind'
    >,
  ): EventView {
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      location: event.location,
      startsAt: event.startsAt,
      closed: isClosed(event),
      createdByName: event.createdByName,
      leaderDiscordUserId: event.leaderDiscordUserId ?? event.createdByDiscordId,
      masterLooterDiscordUserId: event.masterLooterDiscordUserId,
      kind: EVENT_KINDS[event.kind],
      eventUrl: eventPageUrl(this.origin, guild, event.id),
      addCharacterUrl: addCharacterUrl(this.origin, guild),
    };
  }

  /**
   * The pictures the guild's posts use: class icons (or colour dots) and role and leader icons,
   * as Discord emojis of the bot; anything missing falls back to plain emoji.
   */
  async look(guild: Pick<SignupGuild, 'gameVersion'>): Promise<Look> {
    const [classOf, roleOf] = await Promise.all([
      this.classEmojis.forGame(guild.gameVersion),
      this.classEmojis.rolesFor(guild.gameVersion),
    ]);
    return {
      dot: (className) => emojiText(classOf(className)),
      role: (role) => emojiText(roleOf(ROLE_ICON_NAME[role])),
      leader: emojiText(roleOf('Leader')),
      assist: emojiText(roleOf('Assist')),
      masterLooter: emojiText(roleOf('MasterLooter')),
    };
  }

  /** Checks the title and description, trimmed; throws with what is wrong. */
  static validate(input: EventInput): EventInput {
    const title = input.title.trim();
    const description = input.description.trim();
    const location = (input.location ?? '').trim();
    if (location.length > MAX_LOCATION_LENGTH) {
      throw new BadRequestException(
        `The location can be at most ${MAX_LOCATION_LENGTH} characters.`,
      );
    }
    if (title === '') throw new BadRequestException('Give the event a name.');
    if (title.length > MAX_TITLE_LENGTH) {
      throw new BadRequestException(`The name can be at most ${MAX_TITLE_LENGTH} characters.`);
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw new BadRequestException(
        `The description can be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
      );
    }
    return { ...input, title, description, location };
  }

  /**
   * Creates the event and posts it. If Discord refuses the post (no access to the channel, ...)
   * nothing is kept and the reason is thrown. Who may post where is the caller's to check.
   */
  async create(
    guild: SignupGuild,
    creator: { discordId: string; name: string },
    input: EventInput,
    channel: EventChannel,
  ): Promise<EventRow> {
    const valid = SignupEventsService.validate(input);
    if (input.startsAt <= new Date()) {
      throw new BadRequestException('That time has already passed.');
    }
    if (!guild.servers.some((server) => server.discordId === channel.serverId)) {
      throw new BadRequestException('That channel is not in one of the guild’s servers.');
    }
    const scheduled = input.publishAt && input.publishAt > new Date() ? input.publishAt : null;
    if (scheduled && scheduled >= input.startsAt) {
      throw new BadRequestException('Post it before the event starts.');
    }
    const event = await this.prisma.signupEvent.create({
      data: {
        guildId: guild.id,
        kind: input.kind ?? 'CHARACTERS',
        publishAt: scheduled,
        title: valid.title,
        description: valid.description,
        location: valid.location ?? '',
        startsAt: valid.startsAt,
        timezone: valid.timezone,
        serverId: channel.serverId,
        channelId: channel.channelId,
        createdByDiscordId: creator.discordId,
        createdByName: creator.name,
      },
      include: EVENT_INCLUDE,
    });
    // Scheduled: saved as a draft; the worker posts it at `publishAt` (see publishDue).
    if (scheduled) return event;
    try {
      const messageId = await this.discord.sendRichMessage(
        channel.channelId,
        renderEventMessage(this.eventView(guild, event), [], await this.look(guild)),
      );
      return await this.prisma.signupEvent.update({
        where: { id: event.id },
        data: { messageId },
        include: EVENT_INCLUDE,
      });
    } catch (error) {
      await this.prisma.signupEvent.delete({ where: { id: event.id } });
      throw new BadRequestException(`Could not post the event: ${describeDiscordError(error)}`);
    }
  }

  async update(event: EventRow, input: EventInput): Promise<void> {
    const valid = SignupEventsService.validate(input);
    // A scheduled event can move its posting time (still in the future, before it starts).
    let publishAt: Date | undefined;
    if (event.publishAt && input.publishAt) {
      if (input.publishAt <= new Date()) {
        throw new BadRequestException('Pick a posting time still to come, or use Post now.');
      }
      if (input.publishAt >= valid.startsAt) {
        throw new BadRequestException('Post it before the event starts.');
      }
      publishAt = input.publishAt;
    }
    await this.prisma.signupEvent.update({
      where: { id: event.id },
      data: {
        ...(publishAt ? { publishAt } : {}),
        title: valid.title,
        description: valid.description,
        location: valid.location ?? '',
        startsAt: valid.startsAt,
        timezone: valid.timezone,
        // Moved to later: the post opens again (AUTO) and the worker closes it at the new time.
        ...(valid.startsAt > new Date() ? { closedShown: false } : {}),
      },
    });
    this.refresh(event.id);
  }

  async setLockMode(eventId: string, lockMode: SignupLockMode): Promise<void> {
    await this.prisma.signupEvent.update({
      where: { id: eventId },
      data: { lockMode, closedShown: lockMode === 'AUTO' ? false : true },
    });
    this.refresh(eventId);
  }

  /**
   * Posts a scheduled event's sign-up post now (the worker at its time, or "Post now"). It stops
   * being scheduled, with any sign-ups organisers already added. If Discord refuses, it stays
   * scheduled with the reason in `publishError`, and the reason is thrown.
   */
  async publish(eventId: string): Promise<void> {
    const event = await this.prisma.signupEvent.findUniqueOrThrow({
      where: { id: eventId },
      include: { ...EVENT_INCLUDE, guild: { select: GUILD_SELECT } },
    });
    if (!event.publishAt || event.archivedAt) return;
    const live = { ...event, publishAt: null };
    let messageId: string;
    try {
      messageId = await this.discord.sendRichMessage(
        event.channelId,
        renderEventMessage(
          this.eventView(event.guild, live),
          event.entries.map(toEntryView),
          await this.look(event.guild),
        ),
      );
    } catch (error) {
      const reason = describeDiscordError(error);
      await this.prisma.signupEvent.update({
        where: { id: eventId },
        data: { publishError: reason },
      });
      throw new BadRequestException(`Could not post the event: ${reason}`);
    }
    await this.prisma.signupEvent.update({
      where: { id: eventId },
      data: { messageId, publishAt: null, publishError: null },
    });
  }

  /**
   * The worker's part: posts every scheduled event whose time has come. Each is claimed first (its
   * time pushed a minute on), so two workers never post one twice; one that fails is tried again
   * next minute. Never throws.
   */
  async publishDue(now: Date = new Date()): Promise<void> {
    const due = await this.prisma.signupEvent.findMany({
      where: { publishAt: { lte: now }, archivedAt: null },
      select: { id: true, publishAt: true, title: true },
      take: 20,
    });
    for (const event of due) {
      const { count } = await this.prisma.signupEvent.updateMany({
        where: { id: event.id, publishAt: event.publishAt },
        data: { publishAt: new Date(now.getTime() + 60 * 1000) },
      });
      if (count === 0) continue;
      try {
        await this.publish(event.id);
        this.logger.log(`Posted the scheduled event “${event.title}”`);
      } catch (error) {
        this.logger.warn(`Could not post the scheduled event “${event.title}”: ${String(error)}`);
      }
    }
  }

  /** Every message the bot has in Discord for the event: its post, the setup, the assignments. */
  private async messagesOf(event: {
    id: string;
    messageId: string | null;
    setupMessageId: string | null;
  }): Promise<string[]> {
    const assignments = await this.prisma.signupAssignment.findMany({
      where: { eventId: event.id, messageId: { not: null } },
      select: { messageId: true },
    });
    return [
      event.messageId,
      event.setupMessageId,
      ...assignments.map((assignment) => assignment.messageId),
    ].filter((id): id is string => id !== null);
  }

  /** Deletes the event for good and, as far as Discord lets it, every message the bot posted. */
  async delete(event: EventRow): Promise<void> {
    const messageIds = await this.messagesOf(event);
    await this.prisma.signupEvent.delete({ where: { id: event.id } });
    for (const messageId of messageIds) {
      await this.deleteQuietly(event.channelId, messageId);
    }
  }

  /**
   * Archives the event: its messages leave Discord (post, setup, assignments) and it is kept,
   * read-only, with its sign-ups, setup and assignments, under Archived. Already archived: nothing.
   */
  async archive(eventId: string): Promise<void> {
    // Claimed by setting the date, so two callers (a click and the gateway) never both do it.
    const { count } = await this.prisma.signupEvent.updateMany({
      where: { id: eventId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (count === 0) return;
    const event = await this.prisma.signupEvent.findUniqueOrThrow({ where: { id: eventId } });
    for (const messageId of await this.messagesOf(event)) {
      await this.deleteQuietly(event.channelId, messageId);
    }
    await this.prisma.$transaction([
      this.prisma.signupEvent.update({
        where: { id: eventId },
        data: { messageId: null, setupMessageId: null },
      }),
      this.prisma.signupAssignment.updateMany({ where: { eventId }, data: { messageId: null } }),
    ]);
  }

  /**
   * Someone deleted a message in Discord (seen by the worker's live connection). If it was an
   * event's sign-up post, the event is archived — its other messages go too. Never throws.
   */
  async onMessageDeleted(messageId: string): Promise<void> {
    try {
      const event = await this.prisma.signupEvent.findFirst({
        where: { messageId, archivedAt: null },
        select: { id: true, title: true },
      });
      if (!event) return;
      this.logger.log(`The post of “${event.title}” was deleted in Discord: archiving the event`);
      await this.archive(event.id);
    } catch (error) {
      this.logger.warn(`Archiving after a deleted post failed: ${String(error)}`);
    }
  }

  /** Takes the event out of the archive and posts it again (sign-ups as they were). */
  async restore(eventId: string): Promise<void> {
    const event = await this.prisma.signupEvent.update({
      where: { id: eventId },
      // Posted now, so no longer scheduled either.
      data: {
        archivedAt: null,
        messageId: null,
        closedShown: false,
        publishAt: null,
        publishError: null,
      },
      include: { ...EVENT_INCLUDE, guild: { select: GUILD_SELECT } },
    });
    try {
      const messageId = await this.discord.sendRichMessage(
        event.channelId,
        renderEventMessage(
          this.eventView(event.guild, event),
          event.entries.map(toEntryView),
          await this.look(event.guild),
        ),
      );
      await this.prisma.signupEvent.update({ where: { id: eventId }, data: { messageId } });
    } catch (error) {
      // Not in Discord, so back to the archive.
      await this.prisma.signupEvent.update({
        where: { id: eventId },
        data: { archivedAt: new Date() },
      });
      throw new BadRequestException(`Could not post the event: ${describeDiscordError(error)}`);
    }
  }

  /**
   * Brings the event's posts (sign-ups, and the raid setup if posted) up to date, in the
   * background. Calls while one runs are merged into one more run afterwards, so a burst of
   * sign-ups costs at most two edits and the last one always shows the latest state.
   */
  refresh(eventId: string): void {
    if (this.refreshing.has(eventId)) {
      this.refreshAgain.add(eventId);
      return;
    }
    const run = (async () => {
      do {
        this.refreshAgain.delete(eventId);
        try {
          await this.renderPosts(eventId);
        } catch (error) {
          this.logger.warn(`Updating the posts of event ${eventId} failed: ${String(error)}`);
        }
      } while (this.refreshAgain.has(eventId));
    })().finally(() => this.refreshing.delete(eventId));
    this.refreshing.set(eventId, run);
  }

  /** Waits for a background refresh of the event, if one is running (tests, the worker). */
  async settled(eventId: string): Promise<void> {
    await this.refreshing.get(eventId);
  }

  private async renderPosts(eventId: string): Promise<void> {
    const event = await this.prisma.signupEvent.findUnique({
      where: { id: eventId },
      include: { ...EVENT_INCLUDE, guild: { select: GUILD_SELECT } },
    });
    if (!event) return;
    const view = this.eventView(event.guild, event);
    const entries = event.entries.map(toEntryView);
    const look = await this.look(event.guild);
    if (event.messageId) {
      try {
        await this.discord.editRichMessage(
          event.channelId,
          event.messageId,
          renderEventMessage(view, entries, look),
        );
      } catch (error) {
        if (!isDiscordError(error, UNKNOWN_MESSAGE)) throw error;
        // Deleted in Discord (and the live connection didn't catch it): archive the event.
        await this.archive(eventId);
        return;
      }
    }
    if (event.setupMessageId) {
      try {
        await this.discord.editRichMessage(
          event.channelId,
          event.setupMessageId,
          renderSetupMessage(view, entries, event.setupMentions, look),
        );
      } catch (error) {
        if (!isDiscordError(error, UNKNOWN_MESSAGE)) throw error;
        await this.prisma.signupEvent.update({
          where: { id: eventId },
          data: { setupMessageId: null },
        });
      }
    }
  }

  /** Posts the raid setup as its own message, replying to the sign-up post; edits it if posted. */
  async postSetup(eventId: string, mention: boolean): Promise<void> {
    const event = await this.prisma.signupEvent.findUniqueOrThrow({
      where: { id: eventId },
      include: { ...EVENT_INCLUDE, guild: { select: GUILD_SELECT } },
    });
    if (event.setupMessageId) {
      await this.prisma.signupEvent.update({
        where: { id: eventId },
        data: { setupMentions: mention },
      });
      this.refresh(eventId);
      return;
    }
    try {
      const message = renderSetupMessage(
        this.eventView(event.guild, event),
        event.entries.map(toEntryView),
        mention,
        await this.look(event.guild),
      );
      const setupMessageId = await this.discord.sendRichMessage(event.channelId, {
        ...message,
        replyTo: event.messageId ?? undefined,
      });
      await this.prisma.signupEvent.update({
        where: { id: eventId },
        data: { setupMessageId, setupMentions: mention },
      });
    } catch (error) {
      throw new BadRequestException(`Could not post the setup: ${describeDiscordError(error)}`);
    }
  }

  async removeSetup(eventId: string): Promise<void> {
    const event = await this.prisma.signupEvent.findUniqueOrThrow({ where: { id: eventId } });
    if (!event.setupMessageId) return;
    await this.deleteQuietly(event.channelId, event.setupMessageId);
    await this.prisma.signupEvent.update({
      where: { id: eventId },
      data: { setupMessageId: null },
    });
  }

  /** Deletes a message; one that is already gone is fine, other failures are only logged. */
  async deleteQuietly(channelId: string, messageId: string): Promise<void> {
    try {
      await this.discord.deleteMessage(channelId, messageId);
    } catch (error) {
      if (!isDiscordError(error, UNKNOWN_MESSAGE)) {
        this.logger.warn(`Could not delete message ${messageId}: ${describeDiscordError(error)}`);
      }
    }
  }
}
