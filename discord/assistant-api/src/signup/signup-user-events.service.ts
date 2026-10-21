import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, SignupStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { timezoneOfRegion } from '../config/regions';
import { PrismaService } from '../database/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { parseSnowflake } from '../tasks/post-task';
import { readLines } from './assignment-lines';
import { EVENT_KINDS, isEventKind } from './event-kinds';
import { SignupAccessService } from './signup-access.service';
import { SignupAssignmentsService } from './signup-assignments.service';
import { toEntryDto } from './signup-dto';
import { SignupEntriesService } from './signup-entries.service';
import {
  SignupEventsService,
  type EventInput,
  type EventRow,
  type SignupGuild,
} from './signup-events.service';
import { messageUrl } from './signup-messages';
import {
  canCreateEvents,
  canManageEvent,
  canOrganizeEvent,
  canPostIn,
  isClosed,
  isScheduled,
  type SignupViewer,
} from './signup-rules';
import { localParts, parseEventStart, parseInviteTime, resolveTimezone } from './signup-time';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A logged-in user (backoffice or MCP). */
export interface SignupUser {
  id: string;
  discordId: string;
  displayName: string;
}

/** The fields of the event form, as sent (validated here). */
export type EventBody = Record<string, unknown>;

export interface EventListQuery {
  /** `upcoming` (default; soonest first), `past` (started, newest first) or `archived`. */
  view?: string;
  /** Archived only: the event's day in server time (YYYY-MM-DD), both included. */
  from?: string;
  to?: string;
  /** Archived only: words in the name, or its Discord post's id or link. */
  q?: string;
  /** An id or a message link: the event with that Discord post, in any view. */
  discordPostId?: string;
}

/**
 * A Discord post's id, from the id itself or a message link
 * (https://discord.com/channels/<server>/<channel>/<message>); null for anything else.
 */
export function discordPostIdOf(text: string | undefined): string | null {
  const value = (text ?? '').trim();
  if (/^\d{15,25}$/.test(value)) return value;
  return (
    /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(?:\d+|@me)\/\d+\/(\d{15,25})\/?$/.exec(
      value,
    )?.[1] ?? null
  );
}

/**
 * Events as a logged-in user lists, reads and creates them: the backoffice (`SignupController`)
 * and the MCP tools (`SignupMcpTools`) both go through here, so who may do what (signup-rules.ts)
 * is checked the same way.
 */
@Injectable()
export class SignupUserEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly access: SignupAccessService,
    private readonly events: SignupEventsService,
    private readonly entries: SignupEntriesService,
    private readonly assignments: SignupAssignmentsService,
  ) {}

  /** The guild and who the user is in it; throws unless they are in it. */
  async context(
    user: SignupUser,
    guildId: string,
  ): Promise<{ guild: SignupGuild; viewer: SignupViewer }> {
    if (!UUID.test(guildId)) throw new BadRequestException('Unknown guild.');
    const guild = await this.events.findGuild(guildId);
    const viewer = await this.access.forUser(user, guild);
    return { guild, viewer };
  }

  async list(user: SignupUser, guildId: string, query: EventListQuery = {}) {
    const { view, from, to, q, discordPostId } = query;
    const { guild, viewer } = await this.context(user, guildId);
    const now = new Date();
    let where: Prisma.SignupEventWhereInput;
    let orderBy: Prisma.SignupEventOrderByWithRelationInput;
    let take: number;
    const searchedPost = discordPostIdOf(q);
    if (discordPostId !== undefined) {
      const postId = discordPostIdOf(discordPostId);
      if (!postId) throw new BadRequestException('That is not a Discord post id or message link.');
      where = { guildId, discordPostId: postId };
      orderBy = { startsAt: 'desc' };
      take = 1;
    } else if (view === 'archived') {
      const zone = timezoneOfRegion(guild.region);
      const day = (value: string | undefined, end: boolean): Date | undefined => {
        if (!value) return undefined;
        const parsed = DateTime.fromISO(value, { zone });
        if (!parsed.isValid) throw new BadRequestException('Write dates as YYYY-MM-DD.');
        return (end ? parsed.endOf('day') : parsed.startOf('day')).toJSDate();
      };
      const after = day(from, false);
      const before = day(to, true);
      where = {
        guildId,
        archivedAt: { not: null },
        ...(after || before ? { startsAt: { gte: after, lte: before } } : {}),
        ...(searchedPost
          ? { discordPostId: searchedPost }
          : q?.trim()
            ? { title: { contains: q.trim(), mode: 'insensitive' } }
            : {}),
      };
      orderBy = { startsAt: 'desc' };
      take = 100;
    } else {
      const past = view === 'past';
      where = { guildId, archivedAt: null, startsAt: past ? { lte: now } : { gt: now } };
      orderBy = { startsAt: past ? 'desc' : 'asc' };
      take = past ? 30 : 100;
    }
    // Scheduled events are drafts: only organisers see them (Officers all of them, anyone else
    // only their own).
    if (!viewer.isOfficer) {
      where = {
        AND: [where, { OR: [{ publishAt: null }, { createdByDiscordId: viewer.discordId }] }],
      };
    }
    const events = await this.prisma.signupEvent.findMany({
      where,
      orderBy,
      take,
      include: { entries: { select: { status: true, discordUserId: true } } },
    });
    return events.map((event) => {
      const counts: Record<SignupStatus, number> = {
        AVAILABLE: 0,
        LATE: 0,
        TENTATIVE: 0,
        ABSENT: 0,
      };
      for (const entry of event.entries) counts[entry.status]++;
      return {
        id: event.id,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
        timezone: event.timezone,
        closed: isClosed(event, now),
        archivedAt: event.archivedAt?.toISOString() ?? null,
        publishAt: event.publishAt?.toISOString() ?? null,
        discordPostId: event.discordPostId,
        // May delete it (the archived list's Delete button).
        canManage: canManageEvent(viewer, event),
        location: event.location,
        kind: event.kind,
        createdByName: event.createdByName,
        counts,
        myStatus:
          event.entries.find((entry) => entry.discordUserId === user.discordId)?.status ?? null,
      };
    });
  }

  /**
   * Officers and EventCreators. `body.channel` ({ serverId, channelId }) picks the channel, else
   * the guild's event channel; only Officers post elsewhere. `body.type`: CHARACTERS or MEMBERS.
   */
  async create(user: SignupUser, guildId: string, body: EventBody): Promise<{ id: string }> {
    const { guild, viewer } = await this.context(user, guildId);
    if (!canCreateEvents(viewer)) {
      throw new ForbiddenException('Only Officers and EventCreators can create events.');
    }
    const settings = await this.events.getSettings(guildId);
    const picked = body.channel as EventBody | undefined;
    const channel = picked
      ? {
          serverId: parseSnowflake(picked.serverId, 'The server'),
          channelId: parseSnowflake(picked.channelId, 'The channel'),
        }
      : settings.channelId && settings.channelServerId
        ? { serverId: settings.channelServerId, channelId: settings.channelId }
        : null;
    if (!channel) throw new BadRequestException('Pick a channel: the guild has no event channel.');
    if (!canPostIn(viewer, settings.channelId, channel.channelId)) {
      throw new ForbiddenException('Only Officers can post events outside the event channel.');
    }
    const event = await this.events.create(
      guild,
      { discordId: user.discordId, name: user.displayName },
      { ...this.eventInput(guild, body), kind: isEventKind(body.type) ? body.type : 'CHARACTERS' },
      channel,
    );
    this.realtime.publish(guildId, 'signup');
    return { id: event.id };
  }

  /** An event with its sign-ups, setup and assignments, as the user may see it. */
  async get(user: SignupUser, guildId: string, eventId: string) {
    const { guild, viewer } = await this.context(user, guildId);
    if (!UUID.test(eventId)) throw new BadRequestException('Unknown event.');
    const event: EventRow = await this.events.load(guildId, eventId);
    const organizer = canOrganizeEvent(viewer, event);
    // A scheduled event is a draft only organisers see.
    if (isScheduled(event) && !organizer) throw new NotFoundException('Event not found');
    const [myCharacters, assignments] = await Promise.all([
      this.entries.characterOptions(guild, user.discordId),
      this.assignments.list(event.id),
    ]);
    const mine = event.entries.find((entry) => entry.discordUserId === user.discordId);
    const serverTime = timezoneOfRegion(guild.region);
    return {
      id: event.id,
      kind: event.kind,
      // What this kind of event has: groups, assignments, characters (event-kinds.ts).
      layout: EVENT_KINDS[event.kind],
      title: event.title,
      description: event.description,
      location: event.location,
      startsAt: event.startsAt.toISOString(),
      timezone: event.timezone,
      serverTimezone: serverTime,
      local: localParts(event.startsAt, event.timezone),
      // When raid invites start (and the time in the event's timezone, for the edit form).
      invitesAt: event.invitesAt?.toISOString() ?? null,
      inviteTime: event.invitesAt ? localParts(event.invitesAt, event.timezone).time : null,
      lockMode: event.lockMode,
      closed: isClosed(event),
      archivedAt: event.archivedAt?.toISOString() ?? null,
      // Scheduled: when the post goes out (and in the event's timezone, for the edit form), and
      // why the last attempt failed, if it did.
      publishAt: event.publishAt?.toISOString() ?? null,
      publishLocal: event.publishAt ? localParts(event.publishAt, event.timezone) : null,
      publishError: event.publishError,
      createdByName: event.createdByName,
      isOwner: event.createdByDiscordId === user.discordId,
      channel: { serverId: event.serverId, channelId: event.channelId },
      // The sign-up post's Discord id, kept after it is gone (null until first posted).
      discordPostId: event.discordPostId,
      postUrl: event.messageId
        ? messageUrl(event.serverId, event.channelId, event.messageId)
        : null,
      setupPostUrl: event.setupMessageId
        ? messageUrl(event.serverId, event.channelId, event.setupMessageId)
        : null,
      setupMentions: event.setupMentions,
      // Raid roles: the leader (its creator unless changed) and the master looter (or null).
      leaderDiscordUserId: event.leaderDiscordUserId ?? event.createdByDiscordId,
      masterLooterDiscordUserId: event.masterLooterDiscordUserId,
      permissions: {
        canManage: canManageEvent(viewer, event),
        canOrganize: organizer,
        isOfficer: viewer.isOfficer,
      },
      entries: event.entries.map((entry) =>
        toEntryDto(entry, organizer || entry.discordUserId === user.discordId),
      ),
      mine: mine ? toEntryDto(mine, true) : null,
      myCharacters,
      assignments: assignments.map((assignment) => ({
        id: assignment.id,
        scope: assignment.scope,
        scopeLabel: assignment.scopeLabel,
        title: assignment.title,
        lines: readLines(assignment.lines),
        mentions: assignment.mentions,
        imageIds: assignment.images.map((image) => image.id),
        postUrl: assignment.messageId
          ? messageUrl(event.serverId, event.channelId, assignment.messageId)
          : null,
        pluginKey: assignment.pluginKey,
        editedManually: assignment.editedManually,
      })),
    };
  }

  /** Date, time and timezone (`ST` for server time) from the form, plus name and description. */
  eventInput(guild: SignupGuild, body: EventBody): EventInput {
    const zone = resolveTimezone(
      typeof body.timezone === 'string' ? body.timezone : undefined,
      timezoneOfRegion(guild.region),
    );
    if (!zone) throw new BadRequestException('Unknown timezone.');
    const startsAt = parseEventStart(
      typeof body.date === 'string' ? body.date : '',
      typeof body.time === 'string' ? body.time : '',
      zone,
    );
    if (typeof startsAt === 'string') throw new BadRequestException(startsAt);
    // Scheduling: `publishDate` and `publishTime`, in the same timezone as the event.
    let publishAt: Date | undefined;
    if (typeof body.publishDate === 'string' && body.publishDate !== '') {
      const parsed = parseEventStart(
        body.publishDate,
        typeof body.publishTime === 'string' ? body.publishTime : '',
        zone,
      );
      if (typeof parsed === 'string') throw new BadRequestException(`Posting time: ${parsed}`);
      publishAt = parsed;
    }
    // `inviteTime` (HH:mm, the event's day): when raid invites start; '' for none.
    let invitesAt: Date | null | undefined;
    if (typeof body.inviteTime === 'string') {
      if (body.inviteTime.trim() === '') invitesAt = null;
      else {
        const parsed = parseInviteTime(startsAt, body.inviteTime, zone);
        if (typeof parsed === 'string') throw new BadRequestException(parsed);
        invitesAt = parsed;
      }
    }
    return {
      publishAt,
      invitesAt,
      title: typeof body.title === 'string' ? body.title : '',
      description: typeof body.description === 'string' ? body.description : '',
      location: typeof body.location === 'string' ? body.location : '',
      startsAt,
      timezone: zone,
    };
  }
}
