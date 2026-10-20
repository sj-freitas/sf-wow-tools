import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpToolRegistry } from '../mcp/mcp-tool-registry';
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

async function connect(canCreate: boolean) {
  const calls: unknown[][] = [];
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
  new SignupMcpTools(registry, userEvents, config as unknown as ConfigService).onModuleInit();

  const server = new McpServer({ name: 'test', version: '1' });
  registry.apply(server, user);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  const call = async (args: Record<string, unknown>) =>
    (await client.callTool({ name: 'create_event', arguments: args })) as CallToolResult;
  const text = (result: CallToolResult) => (result.content[0] as { text: string }).text;
  return { client, call, text, calls };
}

describe('SignupMcpTools', () => {
  it('adds the event tools to the MCP server', async () => {
    const { client } = await connect(true);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['list_events', 'get_event', 'create_event'],
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
});
