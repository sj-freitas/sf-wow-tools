import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { GuildAccessService } from '../auth/guild-access.service';
import type { PrismaService } from '../database/prisma.service';
import type { GuildsService } from '../guilds/guilds.service';
import type { RanksService } from '../guilds/ranks.service';
import { McpToolRegistry } from '../mcp/mcp-tool-registry';
import { CharacterActionsService } from './character-actions.service';
import { CharactersMcpTools, characterOptions } from './characters-mcp-tools';
import type { CharactersService, RosterCharacter } from './characters.service';
import type { GuildAttributesService } from './guild-attributes.service';

const ME = '111111111111111111';
const THEM = '222222222222222222';
const user = { id: 'u1', discordId: ME, username: 'sam', displayName: 'Sam', avatar: null };

const row = (fields: Partial<RosterCharacter> & { id: string; name: string }): RosterCharacter => {
  const [firstName, lastName = ''] = fields.name.split(' ');
  return {
    firstName,
    lastName,
    class: 'Warrior',
    race: 'Human',
    faction: 'ALLIANCE',
    roles: ['TANK'],
    level: 60,
    verified: false,
    attributes: [],
    player: { discordUserId: ME, username: 'sam', displayName: 'Sam' },
    ...fields,
  };
};

/** A client talking to the roster tools as `user`, with `access` in guild g1 (null: not in it). */
async function connect(access: { isAdmin: boolean; isOfficer: boolean } | null) {
  const created: unknown[][] = [];
  const updated: unknown[][] = [];
  const removed: string[] = [];
  const attributesSet: unknown[][] = [];
  const roster: RosterCharacter[] = [
    row({ id: 'c1', name: 'Arthas Menethil', class: 'Paladin', attributes: ['Main'] }),
    row({
      id: 'c2',
      name: 'Jaina Proudmoore',
      class: 'Mage',
      roles: ['RANGED_DPS'],
      level: 42,
      player: { discordUserId: THEM, username: 'jaina', displayName: 'Jay' },
    }),
  ];
  const characters = {
    findRoster: async () => roster,
    addToGuild: async (guildId: string, discordUserId: string, character: never, names: never) => {
      created.push([guildId, discordUserId, character, names]);
      roster.push(
        row({
          id: 'c9',
          name: 'Thrall Goel',
          player: { discordUserId, username: null, displayName: null },
        }),
      );
      return 'created';
    },
    findGuildMemberNames: async (_guildId: string, id: string) =>
      id === THEM ? { username: 'jaina', displayName: 'Jay' } : null,
    findOwnership: async (id: string) => ({
      discordUserId: roster.find((c) => c.id === id)?.player.discordUserId ?? ME,
      verified: false,
    }),
    update: async (...args: unknown[]) => void updated.push(args),
    removeFromGuild: async (_guildId: string, id: string) => {
      removed.push(id);
      return 'removed' as const;
    },
  } as unknown as CharactersService;
  const guildAccess = {
    find: async () => access,
    assertOfficer: async () => {
      if (!access?.isOfficer) throw new ForbiddenException('Officers only');
    },
  } as unknown as GuildAccessService;
  const registry = new McpToolRegistry();
  new CharactersMcpTools(
    registry,
    new CharacterActionsService(characters, guildAccess),
    characters,
    {
      list: async () => [],
      setForCharacter: async (...args: unknown[]) => void attributesSet.push(args),
    } as unknown as GuildAttributesService,
    guildAccess,
    {
      findPeople: async () => ({
        source: 'servers',
        people: [
          { discordUserId: THEM, username: 'jaina', displayName: 'Jay', characterNames: [] },
          { discordUserId: ME, username: 'sam', displayName: 'Sam', characterNames: ['Arthas'] },
        ],
      }),
    } as unknown as GuildsService,
    { findRanks: async () => ({ [ME]: ['Officer'] }) } as unknown as RanksService,
    {
      guild: { findUnique: async () => ({ gameVersion: 'Forever', faction: 'ALLIANCE' }) },
    } as unknown as PrismaService,
  ).onModuleInit();

  const server = new McpServer({ name: 'test', version: '1' });
  registry.apply(server, user);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  const json = (result: CallToolResult) =>
    JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  const text = (result: CallToolResult) => (result.content[0] as { text: string }).text;
  return { client, call, json, text, created, updated, removed, attributesSet };
}

const member = { isAdmin: false, isOfficer: false };
const officer = { isAdmin: false, isOfficer: true };

describe('CharactersMcpTools', () => {
  it('adds the roster tools to the MCP server', async () => {
    const { client } = await connect(member);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [
        'find_characters',
        'get_character_options',
        'find_people',
        'add_character',
        'update_character',
        'list_migratable_characters',
        'add_existing_character',
        'remove_character',
        'list_attributes',
        'set_character_attributes',
      ],
    );
  });

  describe('find_characters', () => {
    it('lists every character with who plays it and their rank', async () => {
      const { call, json } = await connect(member);
      const found = json(await call('find_characters', { guildId: 'g1' }));
      assert.equal(found.count, 2);
      const [arthas, jaina] = found.characters as RosterCharacter[] &
        { player: { ranks: string[] } }[];
      assert.deepEqual((arthas.player as { ranks: string[] }).ranks, ['Officer']);
      assert.deepEqual((jaina.player as { ranks: string[] }).ranks, []);
    });

    it('combines its filters, ignoring case', async () => {
      const { call, json } = await connect(member);
      const ids = async (filters: Record<string, unknown>) =>
        (
          json(await call('find_characters', { guildId: 'g1', ...filters })).characters as {
            id: string;
          }[]
        ).map((character) => character.id);
      assert.deepEqual(await ids({ class: 'mage' }), ['c2']);
      assert.deepEqual(await ids({ role: 'TANK' }), ['c1']);
      assert.deepEqual(await ids({ maxLevel: 50 }), ['c2']);
      assert.deepEqual(await ids({ query: 'jay' }), ['c2']); // the player's name.
      assert.deepEqual(await ids({ attribute: 'main', race: 'Human' }), ['c1']);
      assert.deepEqual(await ids({ discordUserId: THEM, class: 'Paladin' }), []);
    });

    it('is for members of the guild only', async () => {
      const { call, text } = await connect(null);
      const result = await call('find_characters', { guildId: 'g1' });
      assert.equal(result.isError, true);
      assert.match(text(result), /not a member/);
    });
  });

  it("gives the guild's races, the classes each can be, and every class's specs and roles", () => {
    const options = characterOptions('Forever', 'ALLIANCE');
    assert.equal(options.nameFormat, 'Name-Lastname');
    assert.ok(options.races.some((r) => r.race === 'High Order Skyborne'));
    assert.ok(!options.races.some((r) => r.race === 'Orc'));
    const druid = options.classes.find((c) => c.class === 'Druid');
    assert.deepEqual(
      druid?.specs.find((s) => s.spec === 'Feral'),
      { spec: 'Feral', roles: ['MELEE_DPS', 'TANK'] },
    );
  });

  describe('find_people', () => {
    it('finds members by name, for Officers', async () => {
      const { call, json } = await connect(officer);
      const found = json(await call('find_people', { guildId: 'g1', query: 'JAI' }));
      assert.deepEqual(
        (found.people as { discordUserId: string }[]).map((p) => p.discordUserId),
        [THEM],
      );
    });

    it('is refused to other members', async () => {
      const { call } = await connect(member);
      assert.equal((await call('find_people', { guildId: 'g1' })).isError, true);
    });
  });

  describe('add_character', () => {
    const input = {
      guildId: 'g1',
      name: 'thrall-goel',
      race: 'Human',
      class: 'Warrior',
      roles: ['TANK'],
    };

    it('lets an Officer add one for another member and returns it', async () => {
      const { call, json, created } = await connect(officer);
      const result = await call('add_character', { ...input, discordUserId: THEM });
      assert.equal(result.isError, undefined);
      assert.equal(created[0][1], THEM);
      assert.deepEqual(created[0][2], {
        firstName: 'Thrall',
        lastName: 'Goel',
        class: 'Warrior',
        race: 'Human',
        roles: ['TANK'],
        level: undefined,
      });
      assert.equal(json(result).id, 'c9');
    });

    it('lets a member add only their own', async () => {
      const { call, text, created } = await connect(member);
      const result = await call('add_character', { ...input, discordUserId: THEM });
      assert.equal(result.isError, true);
      assert.match(text(result), /only act for yourself/);
      await call('add_character', input);
      assert.equal(created[0][1], ME);
    });

    it('refuses someone who is not in the guild’s Discord servers', async () => {
      const { call, text } = await connect(officer);
      const result = await call('add_character', { ...input, discordUserId: '333333333333333333' });
      assert.equal(result.isError, true);
      assert.match(text(result), /not a member of any of this guild's Discord servers/);
    });
  });

  describe('update_character', () => {
    it('changes only the fields given, and moves it to another member for an Officer', async () => {
      const { call, updated } = await connect(officer);
      await call('update_character', {
        guildId: 'g1',
        characterId: 'c1',
        level: 61,
        discordUserId: THEM,
      });
      assert.deepEqual(updated[0][0], 'c1');
      assert.deepEqual(updated[0][1], { level: 61 });
      assert.deepEqual(updated[0][2], {
        discordUserId: THEM,
        names: { username: 'jaina', displayName: 'Jay' },
      });
    });

    it("refuses a member changing someone else's character", async () => {
      const { call, text, updated } = await connect(member);
      const result = await call('update_character', { guildId: 'g1', characterId: 'c2', level: 1 });
      assert.equal(result.isError, true);
      assert.match(text(result), /only change your own/);
      assert.deepEqual(updated, []);
    });
  });

  it('removes a character from the roster only once confirmed', async () => {
    const { call, text, removed } = await connect(officer);
    const unconfirmed = await call('remove_character', {
      guildId: 'g1',
      characterId: 'c2',
      confirm: false,
    });
    assert.equal(unconfirmed.isError, true);
    assert.match(text(unconfirmed), /confirm: true/);
    assert.deepEqual(removed, []);
    await call('remove_character', { guildId: 'g1', characterId: 'c2', confirm: true });
    assert.deepEqual(removed, ['c2']);
  });

  it('sets attributes for Officers only', async () => {
    const asMember = await connect(member);
    const refused = await asMember.call('set_character_attributes', {
      guildId: 'g1',
      characterId: 'c1',
      attributeIds: ['a1'],
    });
    assert.equal(refused.isError, true);
    const asOfficer = await connect(officer);
    await asOfficer.call('set_character_attributes', {
      guildId: 'g1',
      characterId: 'c1',
      attributeIds: ['a1'],
    });
    assert.deepEqual(asOfficer.attributesSet, [['g1', 'c1', ['a1']]]);
  });
});
