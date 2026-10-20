import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth.types';
import { siteOrigin } from '../config/site-origin';
import { McpToolRegistry, toolResult } from '../mcp/mcp-tool-registry';
import { eventPageUrl } from './signup-links';
import { SignupUserEventsService } from './signup-user-events.service';

const guildId = z.string().describe('The guild id, from list_guilds');

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
  }
}
