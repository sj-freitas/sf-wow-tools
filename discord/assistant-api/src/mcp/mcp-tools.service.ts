import { ForbiddenException, Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import { GuildsService } from '../guilds/guilds.service';
import { PlayersService } from '../players/players.service';
import { PluginsService } from '../plugins/plugins.service';
import { TasksService } from '../tasks/tasks.service';
import { McpToolRegistry, toolResult as run } from './mcp-tool-registry';

const guildId = z.string().describe('The guild id, from list_guilds');
const postPart = z.object({
  id: z
    .string()
    .optional()
    .describe(
      "The message's id, from get_post; keep it when editing a message, leave it out for a new one",
    ),
  content: z.string().describe('The message, in Discord markdown'),
  seedReactions: z
    .array(z.string())
    .optional()
    .describe('Emojis the bot adds so people can click them'),
  embedLinks: z.boolean().optional().describe('Show link previews (default: yes)'),
  delaySeconds: z.number().int().optional().describe('Seconds to wait after the previous message'),
});
const postFields = {
  name: z.string().optional().describe('A name for the post (only shown in the backoffice)'),
  serverId: z.string().optional().describe('The Discord server id, from list_channels'),
  channelId: z.string().optional().describe('The channel id, from list_channels'),
  parts: z.array(postPart).optional().describe('The messages, sent in order'),
  runAtLocal: z.string().optional().describe('When to post, as yyyy-MM-ddTHH:mm in `timezone`'),
  timezone: z
    .string()
    .optional()
    .describe(
      "runAtLocal's timezone: an IANA zone (Europe/Paris), UTC or an offset; default: the guild's server time",
    ),
  postNow: z.boolean().optional().describe('Post right away instead of at runAtLocal'),
  enabled: z.boolean().optional().describe('False pauses the post'),
  tracked: z.boolean().optional().describe('Keep reaction counts and live tags up to date'),
};

/**
 * The tools an MCP client gets, acting as one user. Each checks access exactly like the matching
 * backoffice endpoint (members read the roster; Officers manage posts and plugins) and calls the
 * same service, so the rules live in one place. Features add more through `McpToolRegistry`.
 */
@Injectable()
export class McpToolsService {
  constructor(
    private readonly guildAccess: GuildAccessService,
    private readonly guilds: GuildsService,
    private readonly players: PlayersService,
    private readonly tasks: TasksService,
    private readonly plugins: PluginsService,
    private readonly registry: McpToolRegistry,
  ) {}

  /** A server with the tools bound to `user` (one per request: the endpoint is stateless). */
  createServer(user: SessionUser): McpServer {
    const server = new McpServer({ name: 'guild-assistant', version: '1.0.0' });
    const userId = user.id;

    server.registerTool(
      'list_guilds',
      {
        title: 'List my guilds',
        description:
          "The guilds you can see, with your access in each (isOfficer: manage posts, plugins and characters; isAdmin: configure the guild). Other tools take a guild's id.",
        annotations: { readOnlyHint: true },
      },
      () => run(() => this.guilds.findForUser(userId)),
    );

    server.registerTool(
      'get_roster',
      {
        title: 'Get roster',
        description: "A guild's players and their characters (class, roles, level).",
        inputSchema: { guildId },
        annotations: { readOnlyHint: true },
      },
      (args) =>
        run(async () => {
          if (!(await this.guildAccess.find(userId, args.guildId))) {
            throw new ForbiddenException('You are not a member of this guild');
          }
          return this.players.findForGuild(args.guildId);
        }),
    );

    server.registerTool(
      'list_channels',
      {
        title: 'List channels',
        description:
          "The text channels of the guild's Discord servers, to pick where a post goes. Officers and Guild-Assistants.",
        inputSchema: { guildId },
        annotations: { readOnlyHint: true },
      },
      (args) =>
        run(async () => {
          await this.guildAccess.assertCanConfigure(userId, args.guildId);
          return this.tasks.listChannels(args.guildId);
        }),
    );

    server.registerTool(
      'list_posts',
      {
        title: 'List posts',
        description:
          "The guild's scheduled and sent posts, newest first, ten per page. Officers only.",
        inputSchema: {
          guildId,
          query: z.string().optional().describe('Search in names and text'),
          page: z.number().int().min(1).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      (args) =>
        run(async () => {
          await this.guildAccess.assertOfficer(userId, args.guildId);
          return this.tasks.list(args.guildId, { query: args.query, page: args.page });
        }),
    );

    server.registerTool(
      'get_post',
      {
        title: 'Get post',
        description: 'One post with its messages, schedule and status. Officers only.',
        inputSchema: { postId: z.string() },
        annotations: { readOnlyHint: true },
      },
      (args) =>
        run(async () => {
          await this.assertOfficerOfPost(userId, args.postId);
          return this.tasks.get(args.postId);
        }),
    );

    server.registerTool(
      'create_post',
      {
        title: 'Create post',
        description:
          'Schedules a post (one or more messages) in a channel, or sends it now with postNow. Needs serverId, channelId and parts. Officers only.',
        inputSchema: { guildId, ...postFields },
      },
      ({ guildId: id, ...input }) =>
        run(async () => {
          await this.guildAccess.assertOfficer(userId, id);
          return this.tasks.create(id, userId, input);
        }),
    );

    server.registerTool(
      'update_post',
      {
        title: 'Update post',
        description:
          'Changes a post; fields left out stay as they are. A post already in Discord is edited there too (messages can be changed but not added). Officers only.',
        inputSchema: { postId: z.string(), ...postFields },
        annotations: { idempotentHint: true },
      },
      ({ postId, ...input }) =>
        run(async () => {
          await this.assertOfficerOfPost(userId, postId);
          return this.tasks.update(postId, input);
        }),
    );

    server.registerTool(
      'list_plugins',
      {
        title: 'List plugins',
        description:
          "The guild's plugins (scheduled jobs like channel clean-ups), with their schedule and recent runs. Officers only.",
        inputSchema: { guildId },
        annotations: { readOnlyHint: true },
      },
      (args) =>
        run(async () => {
          await this.guildAccess.assertOfficer(userId, args.guildId);
          return this.plugins.list(args.guildId);
        }),
    );

    server.registerTool(
      'set_plugin_enabled',
      {
        title: 'Pause or resume a plugin',
        description: 'Turns a plugin on or off. Officers only.',
        inputSchema: { pluginId: z.string(), enabled: z.boolean() },
        annotations: { idempotentHint: true },
      },
      (args) =>
        run(async () => {
          await this.guildAccess.assertOfficer(userId, await this.plugins.guildIdOf(args.pluginId));
          return this.plugins.update(args.pluginId, { enabled: args.enabled });
        }),
    );

    // Tools of features that add their own (event sign-ups).
    this.registry.apply(server, user);
    return server;
  }

  private async assertOfficerOfPost(userId: string, postId: string): Promise<void> {
    await this.guildAccess.assertOfficer(userId, await this.tasks.guildIdOf(postId));
  }
}
