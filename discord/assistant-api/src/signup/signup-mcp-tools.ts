import { BadRequestException, Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GuildAccessService } from '../auth/guild-access.service';
import type { SessionUser } from '../auth/auth.types';
import { siteOrigin } from '../config/site-origin';
import { McpToolRegistry, toolResult } from '../mcp/mcp-tool-registry';
import { PluginsService, type PluginInput } from '../plugins/plugins.service';
import { eventPageUrl } from './signup-links';
import { SignupUserEventsService } from './signup-user-events.service';

const guildId = z.string().describe('The guild id, from list_guilds');

/** A Recurring Event's fields, all optional (an update changes only the ones given). */
const recurringFields = {
  name: z
    .string()
    .optional()
    .describe('The plugin\'s name in the Plugins tab; default "Recurring Event"'),
  channel: z
    .object({ serverId: z.string(), channelId: z.string() })
    .optional()
    .describe('Where it posts, from list_channels. Every other message there is deleted each week'),
  title: z.string().optional().describe('The event\'s name, e.g. "Naxxramas"'),
  description: z.string().optional().describe('Shown on the sign-up post (Discord markdown)'),
  location: z.string().optional().describe('The raid or dungeon, or any place'),
  type: z
    .enum(['CHARACTERS', 'MEMBERS'])
    .optional()
    .describe('CHARACTERS: people sign up with a character and role. MEMBERS: as themselves'),
  eventWeekday: z
    .number()
    .int()
    .min(1)
    .max(7)
    .optional()
    .describe("The event's day: 1 Monday … 7 Sunday. Each post is for the next one"),
  eventTime: z.string().optional().describe("The event's start, HH:mm"),
  eventTimezone: z
    .string()
    .optional()
    .describe("The event time's zone: ST (server time, default), an IANA zone or an offset"),
  postWeekday: z
    .number()
    .int()
    .min(1)
    .max(7)
    .optional()
    .describe('When it archives the open events and posts the next one: 1 Monday … 7 Sunday'),
  postTime: z.string().optional().describe('HH:mm, on postWeekday'),
  scheduleTimezone: z
    .string()
    .optional()
    .describe("postWeekday/postTime's zone: ST (server time, default), an IANA zone or an offset"),
};
type RecurringFields = {
  [K in keyof typeof recurringFields]?: z.infer<(typeof recurringFields)[K]>;
};

/** The event a Recurring Event posts (its config), from the tool's fields over what it had. */
const recurringConfig = (fields: RecurringFields, current: Record<string, unknown> = {}) => ({
  ...current,
  ...(fields.channel && { serverId: fields.channel.serverId, channelId: fields.channel.channelId }),
  ...(fields.title !== undefined && { title: fields.title }),
  ...(fields.description !== undefined && { description: fields.description }),
  ...(fields.location !== undefined && { location: fields.location }),
  ...(fields.type !== undefined && { kind: fields.type }),
  ...(fields.eventWeekday !== undefined && { weekday: fields.eventWeekday }),
  ...(fields.eventTime !== undefined && { time: fields.eventTime }),
  ...(fields.eventTimezone !== undefined && { timezone: fields.eventTimezone }),
});

/**
 * Event sign-ups in the MCP server (`/api/mcp`): list, read and create events, with the same
 * rules as the backoffice (`SignupUserEventsService`). Registered from here so the sign-up
 * feature stays removable on its own: without `src/signup/`, the MCP server just lacks these.
 */
@Injectable()
export class SignupMcpTools implements OnModuleInit {
  private readonly origin: string;

  constructor(
    private readonly registry: McpToolRegistry,
    private readonly userEvents: SignupUserEventsService,
    config: ConfigService,
    private readonly plugins: PluginsService,
    private readonly guildAccess: GuildAccessService,
  ) {
    this.origin = siteOrigin(config);
  }

  onModuleInit(): void {
    this.registry.add((server, user) => this.register(server, user));
  }

  register(server: McpServer, user: SessionUser): void {
    server.registerTool(
      'list_events',
      {
        title: 'List sign-up events',
        description:
          "A guild's sign-up events (raids and other events people sign up to), with sign-up counts. view: upcoming (default, soonest first), past or archived. Members of the guild.",
        inputSchema: {
          guildId,
          view: z.enum(['upcoming', 'past', 'archived']).optional(),
          q: z.string().optional().describe('Archived only: words in the title'),
        },
        annotations: { readOnlyHint: true },
      },
      (args) =>
        toolResult(() => this.userEvents.list(user, args.guildId, { view: args.view, q: args.q })),
    );

    server.registerTool(
      'get_event',
      {
        title: 'Get sign-up event',
        description:
          'One event: its details, who signed up (status, character, role), the raid setup and assignments. Members of the guild.',
        inputSchema: { guildId, eventId: z.string() },
        annotations: { readOnlyHint: true },
      },
      (args) => toolResult(() => this.userEvents.get(user, args.guildId, args.eventId)),
    );

    server.registerTool(
      'create_event',
      {
        title: 'Create sign-up event',
        description:
          "Creates an event people sign up to and posts it in Discord (in the guild's event channel unless a channel is given; or later, with publishDate). Date and time are in the guild's server time unless timezone is set. Officers and EventCreators; only Officers can post outside the event channel. Returns the event's id and page.",
        inputSchema: {
          guildId,
          title: z.string().describe('e.g. "Naxxramas"'),
          date: z.string().describe('YYYY-MM-DD'),
          time: z.string().describe('HH:mm, 24-hour'),
          inviteTime: z
            .string()
            .optional()
            .describe(
              'HH:mm: when raid invites start, before the event (the day before if later than its time). Shown on the post; GuildAssistant RaidSort can invite from then',
            ),
          description: z
            .string()
            .optional()
            .describe('Shown on the sign-up post (Discord markdown)'),
          location: z.string().optional().describe('The raid or dungeon, or any place'),
          type: z
            .enum(['CHARACTERS', 'MEMBERS'])
            .optional()
            .describe(
              'CHARACTERS (default): people sign up with a character and role, for raids. MEMBERS: people sign up as themselves.',
            ),
          timezone: z
            .string()
            .optional()
            .describe('An IANA zone (Europe/Paris) or offset (UTC+2); default: server time'),
          channel: z
            .object({ serverId: z.string(), channelId: z.string() })
            .optional()
            .describe('Where to post it, from list_channels; default: the event channel'),
          publishDate: z
            .string()
            .optional()
            .describe('Post it later instead of now: YYYY-MM-DD (with publishTime)'),
          publishTime: z.string().optional().describe('HH:mm'),
        },
      },
      ({ guildId: id, ...body }) =>
        toolResult(async () => {
          const created = await this.userEvents.create(user, id, body);
          const { guild } = await this.userEvents.context(user, id);
          return { ...created, url: eventPageUrl(this.origin, guild, created.id) };
        }),
    );

    // Recurring Events (a plugin kind of sign-ups): through PluginsService, the website's rules.
    server.registerTool(
      'create_recurring_event',
      {
        title: 'Create a Recurring Event',
        description:
          'Posts the same sign-up event every week (e.g. a raid night): each week, on postWeekday at postTime, it archives the events still open in its channel, deletes every other message there (pinned ones too) and posts the event for the next eventWeekday at eventTime. Its first run only posts (now with firstRun "now"). Officers only. It deletes messages on its own, so ask the user first and pass confirm: true only once they agreed.',
        inputSchema: {
          guildId,
          ...recurringFields,
          channel: recurringFields.channel.unwrap(),
          title: recurringFields.title.unwrap(),
          eventWeekday: recurringFields.eventWeekday.unwrap(),
          eventTime: recurringFields.eventTime.unwrap(),
          postWeekday: recurringFields.postWeekday.unwrap(),
          postTime: recurringFields.postTime.unwrap(),
          firstRun: z
            .string()
            .optional()
            .describe('"now", or yyyy-MM-ddTHH:mm in the schedule\'s zone; default: its schedule'),
          confirm: z
            .boolean()
            .describe('Must be true: the user agreed to a plugin that deletes messages weekly'),
        },
      },
      ({ guildId: id, confirm, firstRun, ...fields }) =>
        toolResult(async () => {
          await this.guildAccess.assertOfficer(user.id, id);
          const input: PluginInput = {
            kind: 'RECURRING_EVENT',
            name: fields.name,
            scheduleKind: 'WEEKLY',
            weekday: fields.postWeekday,
            timeOfDay: fields.postTime,
            timezone: fields.scheduleTimezone,
            config: recurringConfig(fields),
            firstRun,
            confirm,
          };
          return this.plugins.create(id, user.id, input);
        }),
    );

    server.registerTool(
      'update_recurring_event',
      {
        title: 'Change a Recurring Event',
        description:
          'Changes a Recurring Event (from list_plugins): any of its fields, only the ones given. The event it already posted stays as it is; the change applies from its next post. Officers only.',
        inputSchema: { pluginId: z.string(), ...recurringFields },
        annotations: { idempotentHint: true },
      },
      ({ pluginId, ...fields }) =>
        toolResult(async () => {
          const plugin = await this.plugins.get(pluginId);
          await this.guildAccess.assertOfficer(user.id, await this.plugins.guildIdOf(pluginId));
          if (plugin.kind !== 'RECURRING_EVENT') {
            throw new BadRequestException('That plugin is not a Recurring Event.');
          }
          const configChanged =
            fields.channel !== undefined ||
            fields.title !== undefined ||
            fields.description !== undefined ||
            fields.location !== undefined ||
            fields.type !== undefined ||
            fields.eventWeekday !== undefined ||
            fields.eventTime !== undefined ||
            fields.eventTimezone !== undefined;
          const input: PluginInput = {
            ...(fields.name !== undefined && { name: fields.name }),
            ...(fields.postWeekday !== undefined && { weekday: fields.postWeekday }),
            ...(fields.postTime !== undefined && { timeOfDay: fields.postTime }),
            ...((fields.postWeekday !== undefined || fields.postTime !== undefined) && {
              scheduleKind: 'WEEKLY',
            }),
            ...(fields.scheduleTimezone !== undefined && { timezone: fields.scheduleTimezone }),
            ...(configChanged && { config: recurringConfig(fields, plugin.config) }),
          };
          return this.plugins.update(pluginId, input);
        }),
    );
  }
}
