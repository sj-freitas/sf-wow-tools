import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PrismaService } from '../database/prisma.service';
import { GuildAccessService } from '../auth/guild-access.service';
import type { GuildsService } from '../guilds/guilds.service';
import type { PlayersService } from '../players/players.service';
import type { PluginsService } from '../plugins/plugins.service';
import type { TasksService } from '../tasks/tasks.service';
import { McpToolRegistry } from './mcp-tool-registry';
import { McpToolsService } from './mcp-tools.service';

const user = { id: 'u1', discordId: 'd1', username: 'sam', displayName: 'Sam', avatar: null };

/** A client talking to the tools as `user`, who has `access` in guild g1 (null: not a member). */
async function connect(access: { isAdmin: boolean; isOfficer: boolean } | null) {
  const calls: unknown[][] = [];
  const prisma = {
    guildAccess: { findUnique: async () => access },
  } as unknown as PrismaService;
  const tasks = {
    guildIdOf: async () => 'g1',
    list: async (...args: unknown[]) => (calls.push(['list', ...args]), { posts: [] }),
    update: async (...args: unknown[]) => (calls.push(['update', ...args]), { id: 'p1' }),
  } as unknown as TasksService;
  const players = { findForGuild: async () => [{ name: 'Olga' }] } as unknown as PlayersService;
  const service = new McpToolsService(
    new GuildAccessService(prisma),
    { findForUser: async () => [{ id: 'g1' }] } as unknown as GuildsService,
    players,
    tasks,
    {
      guildIdOf: async () => 'g1',
      runNow: async (...args: unknown[]) => void calls.push(['runNow', ...args]),
    } as unknown as PluginsService,
    new McpToolRegistry(),
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await service.createServer(user).connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = (result: CallToolResult) => (result.content[0] as { text: string }).text;
  return { client, call, text, calls };
}

describe('McpToolsService', () => {
  it('lists the tools', async () => {
    const { client } = await connect(null);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [
        'list_guilds',
        'get_roster',
        'list_channels',
        'list_posts',
        'get_post',
        'create_post',
        'update_post',
        'list_plugins',
        'set_plugin_enabled',
        'run_plugin_now',
      ],
    );
  });

  it('runs a plugin now for an Officer who confirmed, and nobody else', async () => {
    const officer = await connect({ isAdmin: false, isOfficer: true });
    const unconfirmed = await officer.call('run_plugin_now', { pluginId: 'p1', confirm: false });
    assert.equal(unconfirmed.isError, true);
    assert.match(officer.text(unconfirmed), /confirm: true/);
    assert.deepEqual(officer.calls, []);
    const ran = await officer.call('run_plugin_now', { pluginId: 'p1', confirm: true });
    assert.equal(ran.isError, undefined);
    assert.deepEqual(officer.calls, [['runNow', 'p1']]);

    const member = await connect({ isAdmin: false, isOfficer: false });
    const refused = await member.call('run_plugin_now', { pluginId: 'p1', confirm: true });
    assert.equal(refused.isError, true);
    assert.deepEqual(member.calls, []);
  });

  it('shows a member the roster, and an outsider an error', async () => {
    const member = await connect({ isAdmin: false, isOfficer: false });
    const roster = await member.call('get_roster', { guildId: 'g1' });
    assert.equal(roster.isError, undefined);
    assert.deepEqual(JSON.parse(member.text(roster)), [{ name: 'Olga' }]);

    const outsider = await connect(null);
    const denied = await outsider.call('get_roster', { guildId: 'g1' });
    assert.equal(denied.isError, true);
    assert.match(outsider.text(denied), /not a member/);
  });

  it('keeps posts to Officers, like the backoffice', async () => {
    const member = await connect({ isAdmin: true, isOfficer: false });
    const denied = await member.call('list_posts', { guildId: 'g1' });
    assert.equal(denied.isError, true);
    assert.match(member.text(denied), /Officer/);
    assert.equal(member.calls.length, 0);

    const officer = await connect({ isAdmin: false, isOfficer: true });
    const listed = await officer.call('list_posts', { guildId: 'g1', query: 'raid' });
    assert.equal(listed.isError, undefined);
    assert.deepEqual(officer.calls, [['list', 'g1', { query: 'raid', page: undefined }]]);
  });

  it('passes only the fields given to update_post', async () => {
    const officer = await connect({ isAdmin: false, isOfficer: true });
    await officer.call('update_post', { postId: 'p1', name: 'Raid night' });
    assert.deepEqual(officer.calls, [['update', 'p1', { name: 'Raid night' }]]);
  });
});
