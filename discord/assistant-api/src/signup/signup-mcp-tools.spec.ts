import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { GuildAccessService } from '../auth/guild-access.service';
import { McpToolRegistry } from '../mcp/mcp-tool-registry';
import type { PluginInput, PluginsService } from '../plugins/plugins.service';
import { SignupMcpTools } from './signup-mcp-tools';
import type { SignupUserEventsService } from './signup-user-events.service';

const user = { id: 'u1', discordId: 'd1', username: 'sam', displayName: 'Sam', avatar: null };
const guild = {
  id: 'g1',
  name: 'Night Watch',
  slug: 'night-watch',
  gameVersion: 'Forever',
  region: 'EU',
  realm: 'Gehennas',
};

async function connect(canCreate: boolean, isOfficer = true) {
  const calls: unknown[][] = [];
  // Plugins: what was created and changed, and one Recurring Event already there.
  const created: PluginInput[] = [];
  const updated: { id: string; input: PluginInput }[] = [];
  const existing: Record<string, { kind: string; config: Record<string, unknown> }> = {
    p1: {
      kind: 'RECURRING_EVENT',
      config: {
        serverId: 's1',
        channelId: 'c1',
        kind: 'CHARACTERS',
        title: 'Naxxramas',
        description: '',
        location: '',
        weekday: 3,
        time: '20:00',
        timezone: 'ST',
      },
    },
    p2: { kind: 'CHANNEL_CLEANUP', config: {} },
  };
  const plugins = {
    create: async (_guildId: string, _userId: string, input: PluginInput) => {
      created.push(input);
      return { id: 'p9' };
    },
    get: async (id: string) => ({ id, ...existing[id] }),
    guildIdOf: async () => 'g1',
    update: async (id: string, input: PluginInput) => {
      updated.push({ id, input });
      return { id };
    },
  } as unknown as PluginsService;
  const access = {
    assertOfficer: async () => {
      if (!isOfficer) throw new ForbiddenException('Officers only');
    },
  } as unknown as GuildAccessService;
  const userEvents = {
    create: async (...args: unknown[]) => {
      calls.push(args);
      if (!canCreate) {
        throw new ForbiddenException('Only Officers and EventCreators can create events.');
      }
      return { id: 'e1' };
    },
    context: async () => ({ guild }),
  } as unknown as SignupUserEventsService;
  const config = { get: (key: string) => (key === 'SITE_URL' ? 'https://guild.test' : undefined) };
  const registry = new McpToolRegistry();
  new SignupMcpTools(
    registry,
    userEvents,
    config as unknown as ConfigService,
    plugins,
    access,
  ).onModuleInit();

  const server = new McpServer({ name: 'test', version: '1' });
  registry.apply(server, user);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  const call = async (args: Record<string, unknown>) =>
    (await client.callTool({ name: 'create_event', arguments: args })) as CallToolResult;
  const text = (result: CallToolResult) => (result.content[0] as { text: string }).text;
  const tool = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { client, call, tool, text, calls, created, updated };
}

describe('SignupMcpTools', () => {
  it('adds the event tools to the MCP server', async () => {
    const { client } = await connect(true);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [
        'list_events',
        'get_event',
        'create_event',
        'create_recurring_event',
        'update_recurring_event',
      ],
    );
  });

  it('creates an event as the user and links its page', async () => {
    const { call, text, calls } = await connect(true);
    const result = await call({
      guildId: 'g1',
      title: 'Naxxramas',
      date: '2026-11-01',
      time: '20:00',
      location: 'Naxxramas',
    });
    assert.equal(result.isError, undefined);
    const created = JSON.parse(text(result)) as { id: string; url: string };
    assert.equal(created.id, 'e1');
    assert.match(created.url, /^https:\/\/guild\.test\/.+\/signup\/e1$/);
    assert.deepEqual(calls, [
      [
        user,
        'g1',
        { title: 'Naxxramas', date: '2026-11-01', time: '20:00', location: 'Naxxramas' },
      ],
    ]);
  });

  it('says why when the user may not create events', async () => {
    const { call, text } = await connect(false);
    const result = await call({ guildId: 'g1', title: 'Naxx', date: '2026-11-01', time: '20:00' });
    assert.equal(result.isError, true);
    assert.match(text(result), /Only Officers and EventCreators/);
  });

  describe('Recurring Events', () => {
    const naxx = {
      guildId: 'g1',
      channel: { serverId: 's1', channelId: 'c1' },
      title: 'Naxxramas',
      location: 'Naxxramas',
      eventWeekday: 3,
      eventTime: '20:00',
      postWeekday: 3,
      postTime: '23:00',
      firstRun: 'now',
    };

    it("creates one with the website's rules: weekly, its event as config, confirmed", async () => {
      const { tool, created } = await connect(true);
      const result = await tool('create_recurring_event', { ...naxx, confirm: true });
      assert.equal(result.isError, undefined);
      assert.deepEqual(created, [
        {
          kind: 'RECURRING_EVENT',
          name: undefined,
          scheduleKind: 'WEEKLY',
          weekday: 3,
          timeOfDay: '23:00',
          timezone: undefined,
          config: {
            serverId: 's1',
            channelId: 'c1',
            title: 'Naxxramas',
            location: 'Naxxramas',
            weekday: 3,
            time: '20:00',
          },
          firstRun: 'now',
          confirm: true,
        },
      ]);
    });

    it('is for Officers only', async () => {
      const { tool, text, created } = await connect(true, false);
      const result = await tool('create_recurring_event', { ...naxx, confirm: true });
      assert.equal(result.isError, true);
      assert.match(text(result), /Officers only/);
      assert.deepEqual(created, []);
    });

    it('changes only the fields given, keeping the rest of its event', async () => {
      const { tool, updated } = await connect(true);
      const result = await tool('update_recurring_event', {
        pluginId: 'p1',
        title: 'Naxxramas (25)',
        postTime: '22:00',
      });
      assert.equal(result.isError, undefined);
      assert.deepEqual(updated, [
        {
          id: 'p1',
          input: {
            timeOfDay: '22:00',
            scheduleKind: 'WEEKLY',
            config: {
              serverId: 's1',
              channelId: 'c1',
              kind: 'CHARACTERS',
              title: 'Naxxramas (25)',
              description: '',
              location: '',
              weekday: 3,
              time: '20:00',
              timezone: 'ST',
            },
          },
        },
      ]);
    });

    it('refuses to change a plugin that is not a Recurring Event', async () => {
      const { tool, text, updated } = await connect(true);
      const result = await tool('update_recurring_event', { pluginId: 'p2', title: 'x' });
      assert.equal(result.isError, true);
      assert.match(text(result), /not a Recurring Event/);
      assert.deepEqual(updated, []);
    });
  });
});
