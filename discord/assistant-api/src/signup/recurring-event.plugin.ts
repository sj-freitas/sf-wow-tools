import { BadRequestException, Injectable, type OnModuleInit } from '@nestjs/common';
import type { SignupEventKind } from '@prisma/client';
import { DateTime } from 'luxon';
import { timezoneOfRegion } from '../config/regions';
import { PrismaService } from '../database/prisma.service';
import { parseGuildChannel } from '../plugins/plugin-channel';
import { PluginKindRegistry, type PluginKindDef } from '../plugins/plugin-kinds';
import { nextOccurrence } from '../tasks/schedule';
import { isEventKind } from './event-kinds';
import { SignupEventsService } from './signup-events.service';
import { MAX_DESCRIPTION_LENGTH, MAX_LOCATION_LENGTH, MAX_TITLE_LENGTH } from './signup-rules';
import { parseTimeOfDay, resolveTimezone, SERVER_TIME } from './signup-time';

/** The event a Recurring Event plugin posts each time, and where. */
export interface RecurringEventConfig {
  serverId: string;
  channelId: string;
  kind: SignupEventKind;
  title: string;
  description: string;
  location: string;
  /** When the event itself starts: the next one of this ISO weekday (1-7) and "HH:mm". */
  weekday: number;
  time: string;
  /** `ST` (the guild's server time, following its region) or an IANA zone / offset. */
  timezone: string;
}

const plural = (count: number) => `${count} event${count === 1 ? '' : 's'}`;

/**
 * Recurring Event, a plugin kind of event sign-ups: each time it runs (e.g. every Wednesday at
 * 23:00) it archives the events still open in its channel and posts the next one (e.g. next
 * Wednesday's raid at 20:00) from its saved form. Its first run (right after it is added, or at
 * a time picked for it: the plugins' `firstRun`) only posts. Editing the plugin changes the events it posts
 * from then on, never the one already posted; pausing it stops both the archiving and the posting.
 * Registered from here, not in `src/plugins`, so sign-ups stay removable on their own.
 */
@Injectable()
export class RecurringEventPlugin implements OnModuleInit {
  constructor(
    private readonly registry: PluginKindRegistry,
    private readonly events: SignupEventsService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.add(this.def);
  }

  readonly def: PluginKindDef<RecurringEventConfig> = {
    kind: 'RECURRING_EVENT',
    label: 'Recurring Event',
    description:
      'Posts the same sign-up event every week (e.g. a raid night), archiving the previous one in its channel.',
    scheduleKinds: ['WEEKLY'],

    parseConfig: async (input, context) => {
      const config = (input ?? {}) as Record<string, unknown>;
      const { serverId, channelId } = await parseGuildChannel(config, context);
      const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
      const title = text(config.title);
      if (!title) throw new BadRequestException('Give the event a name.');
      if (title.length > MAX_TITLE_LENGTH) {
        throw new BadRequestException(`The name can be at most ${MAX_TITLE_LENGTH} characters.`);
      }
      const description = text(config.description);
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        throw new BadRequestException(
          `The description can be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
        );
      }
      const location = text(config.location);
      if (location.length > MAX_LOCATION_LENGTH) {
        throw new BadRequestException(
          `The location can be at most ${MAX_LOCATION_LENGTH} characters.`,
        );
      }
      const weekday = Number(config.weekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
        throw new BadRequestException('Pick the day of the week the event is on.');
      }
      const time = text(config.time);
      if (!parseTimeOfDay(time)) {
        throw new BadRequestException('Write the event’s time as HH:mm, for example 20:00.');
      }
      const timezone = text(config.timezone) || SERVER_TIME;
      if (!resolveTimezone(timezone, 'UTC')) throw new BadRequestException('Unknown timezone.');
      return {
        serverId,
        channelId,
        kind: isEventKind(config.kind) ? config.kind : 'CHARACTERS',
        title,
        description,
        location,
        weekday,
        time,
        timezone,
      };
    },

    run: async (plugin, context) => {
      const config = plugin.config;
      const guild = await this.events.findGuild(plugin.guildId);
      const serverZone = timezoneOfRegion(guild.region);
      const zone = resolveTimezone(config.timezone, serverZone) ?? serverZone;
      const now = new Date(context.clock());

      // The first post (when the plugin is added, or at the time picked for it) archives nothing;
      // from then on each run replaces the channel's open events with the next one.
      const firstPost =
        (await this.prisma.pluginRun.count({
          where: { pluginId: plugin.id, status: 'SUCCESS' },
        })) === 0;
      const open = firstPost
        ? []
        : await this.prisma.signupEvent.findMany({
            where: { guildId: plugin.guildId, channelId: config.channelId, archivedAt: null },
            select: { id: true },
          });
      for (const event of open) await this.events.archive(event.id);

      const startsAt = nextOccurrence(
        { kind: 'WEEKLY', weekday: config.weekday, timeOfDay: config.time },
        zone,
        now,
      )!;
      const event = await this.events.create(
        guild,
        await this.ownerOf(plugin.createdById, plugin.name),
        {
          kind: config.kind,
          title: config.title,
          description: config.description,
          location: config.location,
          startsAt,
          timezone: zone,
        },
        { serverId: config.serverId, channelId: config.channelId },
      );
      const when = DateTime.fromJSDate(startsAt, { zone }).toFormat('ccc d LLL, HH:mm');
      const archived = open.length > 0 ? `Archived ${plural(open.length)}; posted` : 'Posted';
      return {
        result: `${archived} “${event.title}” for ${when}.`,
        state: { lastEventId: event.id },
      };
    },
  };

  /**
   * The events it posts belong to the Officer who added the plugin (they and Officers manage
   * them); if that account is gone, to no one in particular, so only Officers do.
   */
  private async ownerOf(
    userId: string | null,
    fallbackName: string,
  ): Promise<{ discordId: string; name: string }> {
    const user = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: { discordId: true, username: true, displayName: true },
        })
      : null;
    return user
      ? { discordId: user.discordId, name: user.displayName ?? user.username }
      : { discordId: '0', name: fallbackName };
  }
}
