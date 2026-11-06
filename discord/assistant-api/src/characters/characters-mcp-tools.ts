import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Role } from '@prisma/client';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import { PrismaService } from '../database/prisma.service';
import { getGame, racesOf, requiresLastName, rolesOfClass } from '../game/games';
import { GuildsService } from '../guilds/guilds.service';
import { RanksService, type RanksDto } from '../guilds/ranks.service';
import { McpToolRegistry, toolResult } from '../mcp/mcp-tool-registry';
import { CharacterActionsService } from './character-actions.service';
import { parseCharacterName } from './character-name';
import { CharactersService, type RosterCharacter } from './characters.service';
import { GuildAttributesService } from './guild-attributes.service';
import { ROLE_LABELS } from './role-labels';

const guildId = z.string().describe('The guild id, from list_guilds');
const characterId = z.string().describe("The character's id, from find_characters");
const role = z.enum(['TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS']);
const discordUserId = z
  .string()
  .describe('A Discord user id (digits), from find_people or find_characters');

/** A character's fields, all optional: an update changes only the ones given. */
const characterFields = {
  name: z
    .string()
    .optional()
    .describe(
      'Name, or Name-Lastname for game versions with last names (see get_character_options)',
    ),
  race: z
    .string()
    .optional()
    .describe("One of the guild faction's races, from get_character_options"),
  class: z.string().optional().describe('A class that race can be, from get_character_options'),
  roles: z
    .array(role)
    .optional()
    .describe('The roles it plays (at least one), among those its class can play'),
  level: z.number().int().min(1).max(100).optional(),
};

/** How many people `find_people` returns at most. */
const MAX_PEOPLE = 25;

/**
 * The roster in the MCP server (`/api/mcp`): find characters (race, class, level, roles,
 * attributes, who plays them and their rank), the races, classes and specs a character can have,
 * and adding, changing, moving and removing characters. Every change goes through
 * `CharacterActionsService`, the backoffice's own rules: members manage their own characters,
 * Officers everyone's (and add them for another member, by Discord id); a character verified on
 * Battle.net only its player changes.
 */
@Injectable()
export class CharactersMcpTools implements OnModuleInit {
  constructor(
    private readonly registry: McpToolRegistry,
    private readonly actions: CharacterActionsService,
    private readonly characters: CharactersService,
    private readonly attributes: GuildAttributesService,
    private readonly guildAccess: GuildAccessService,
    private readonly guilds: GuildsService,
    private readonly ranks: RanksService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.add((server, user) => this.register(server, user));
  }

  register(server: McpServer, user: SessionUser): void {
    server.registerTool(
      'find_characters',
      {
        title: 'Find characters',
        description:
          "A guild's characters, one row each: race, class, level, roles, faction, the guild's attributes it has (main, alt…), whether it is verified, and who plays it (Discord id, name and rank: Officer, Raider, Social). Every filter is optional and they combine. Members of the guild.",
        inputSchema: {
          guildId,
          query: z.string().optional().describe("Words in the character's or the player's name"),
          class: z.string().optional(),
          race: z.string().optional(),
          role: role.optional().describe('Characters that play this role'),
          minLevel: z.number().int().optional(),
          maxLevel: z.number().int().optional(),
          discordUserId: discordUserId.optional().describe("One player's characters"),
          attribute: z.string().optional().describe('Characters with this attribute, by name'),
        },
        annotations: { readOnlyHint: true },
      },
      ({ guildId: id, ...filters }) =>
        toolResult(async () => {
          await this.assertMember(user, id);
          const [roster, ranks] = await Promise.all([
            this.characters.findRoster(id),
            // Ranks come from Discord; without them the roster is still worth having.
            this.ranks.findRanks(id).catch((): RanksDto => ({})),
          ]);
          const found = roster.filter((character) => matches(character, filters));
          return {
            count: found.length,
            characters: found.map((character) => ({
              ...character,
              player: { ...character.player, ranks: ranks[character.player.discordUserId] ?? [] },
            })),
          };
        }),
    );

    server.registerTool(
      'get_character_options',
      {
        title: 'Character options',
        description:
          "What a character of this guild can be: its game version's races (of the guild's faction) and the classes each can be, every class's specs and the roles they play, and whether names need a last name. Use it before add_character or update_character. Members of the guild.",
        inputSchema: { guildId },
        annotations: { readOnlyHint: true },
      },
      (args) =>
        toolResult(async () => {
          await this.assertMember(user, args.guildId);
          const guild = await this.prisma.guild.findUnique({
            where: { id: args.guildId },
            select: { gameVersion: true, faction: true },
          });
          if (!guild) throw new NotFoundException('Guild not found');
          return characterOptions(guild.gameVersion, guild.faction);
        }),
    );

    server.registerTool(
      'find_people',
      {
        title: 'Find people',
        description: `Members of the guild's Discord servers, by name, with their Discord id and the characters they have in this guild: to add a character for someone ("add a character for xyz"), find their Discord id here first. At most ${MAX_PEOPLE}. Officers only.`,
        inputSchema: {
          guildId,
          query: z.string().optional().describe('Words in their Discord username or name'),
        },
        annotations: { readOnlyHint: true },
      },
      (args) =>
        toolResult(async () => {
          await this.guildAccess.assertOfficer(user.id, args.guildId);
          const { source, people } = await this.guilds.findPeople(args.guildId);
          const words = searchWords(args.query);
          const found = people.filter((person) =>
            words.every((word) =>
              [person.username, person.displayName, ...person.characterNames].some((text) =>
                text?.toLowerCase().includes(word),
              ),
            ),
          );
          return {
            // `known`: Discord would not list the servers' members, so only players we know.
            source,
            count: found.length,
            people: found.slice(0, MAX_PEOPLE),
          };
        }),
    );

    server.registerTool(
      'add_character',
      {
        title: 'Add character',
        description:
          "Adds a new character to the guild's roster: yours, or (Officers) another member's by discordUserId (from find_people). name, race, class and roles are required (see get_character_options). If that player already has the character on the guild's server, use list_migratable_characters and add_existing_character instead. Returns the new character.",
        inputSchema: {
          guildId,
          ...characterFields,
          name: z.string().describe(characterFields.name.description ?? ''),
          race: z.string().describe(characterFields.race.description ?? ''),
          class: z.string().describe(characterFields.class.description ?? ''),
          roles: z
            .array(role)
            .min(1)
            .describe(characterFields.roles.description ?? ''),
          discordUserId: discordUserId
            .optional()
            .describe('Who plays it (Officers only); leave it out for your own'),
        },
      },
      ({ guildId: id, ...input }) =>
        toolResult(async () => {
          await this.actions.create(user, id, input);
          // The new character, found by its player and its name as stored (create checked it).
          const owner = input.discordUserId ?? user.discordId;
          const name = parseCharacterName(input.name);
          const added = (await this.characters.findRoster(id)).find(
            (character) =>
              character.player.discordUserId === owner &&
              character.firstName === name?.firstName &&
              character.lastName === name.lastName,
          );
          return added ?? { ok: true };
        }),
    );

    server.registerTool(
      'update_character',
      {
        title: 'Update character',
        description:
          "Changes a character of the guild's roster; fields left out stay as they are. The same character is in every guild it is on, so this changes it there too. faction: a deliberate faction change (the race must exist on the new side; pass the new race too when it doesn't). discordUserId moves it to another member (Officers only). Yours, or anyone's for an Officer, unless its player verified it on Battle.net.",
        inputSchema: {
          guildId,
          characterId,
          ...characterFields,
          faction: z.enum(['ALLIANCE', 'HORDE']).optional(),
          discordUserId: discordUserId
            .optional()
            .describe('Move it to this member (Officers only)'),
        },
        annotations: { idempotentHint: true },
      },
      ({ guildId: id, characterId: character, ...input }) =>
        toolResult(async () => {
          await this.actions.update(user, id, character, input);
          return (
            (await this.characters.findRoster(id)).find((row) => row.id === character) ?? {
              ok: true,
            }
          );
        }),
    );

    server.registerTool(
      'list_migratable_characters',
      {
        title: 'Characters to bring in',
        description:
          "A player's characters already on this guild's server and faction but not on its roster (from another guild): add one with add_existing_character rather than adding it again. Yours, or (Officers) another member's by discordUserId.",
        inputSchema: { guildId, discordUserId: discordUserId.optional() },
        annotations: { readOnlyHint: true },
      },
      (args) => toolResult(() => this.actions.migratable(user, args.guildId, args.discordUserId)),
    );

    server.registerTool(
      'add_existing_character',
      {
        title: 'Bring a character in',
        description:
          "Adds a character from list_migratable_characters to this guild's roster (the same character, not a copy). Yours, or anyone's for an Officer.",
        inputSchema: {
          guildId,
          characterId: z.string().describe("The character's id, from list_migratable_characters"),
        },
        annotations: { idempotentHint: true },
      },
      (args) =>
        toolResult(async () => {
          await this.actions.migrate(user, args.guildId, args.characterId);
          return { ok: true };
        }),
    );

    server.registerTool(
      'remove_character',
      {
        title: 'Remove character from roster',
        description:
          "Takes a character off this guild's roster. The character itself is kept (its other guilds, its bio, its professions), so it can be brought back with add_existing_character. Yours, or anyone's for an Officer. Ask the user first and pass confirm: true once they agreed.",
        inputSchema: {
          guildId,
          characterId,
          confirm: z.boolean().describe('Must be true: the user agreed to remove it'),
        },
        annotations: { destructiveHint: true },
      },
      (args) =>
        toolResult(async () => {
          if (args.confirm !== true) {
            throw new BadRequestException('Confirm removing the character: pass confirm: true.');
          }
          await this.actions.remove(user, args.guildId, args.characterId);
          return { ok: true };
        }),
    );

    server.registerTool(
      'list_attributes',
      {
        title: 'List attributes',
        description:
          "The guild's character attributes (labels like Main, Alt, Switcher), with their ids and which characters have them. Members of the guild.",
        inputSchema: { guildId },
        annotations: { readOnlyHint: true },
      },
      (args) =>
        toolResult(async () => {
          await this.assertMember(user, args.guildId);
          return this.attributes.list(args.guildId);
        }),
    );

    server.registerTool(
      'set_character_attributes',
      {
        title: 'Set character attributes',
        description:
          'Sets exactly which attributes (ids from list_attributes) a character of the roster has: the ones left out are taken off. Officers only.',
        inputSchema: {
          guildId,
          characterId,
          attributeIds: z.array(z.string()).describe('All its attributes from now on; [] for none'),
        },
        annotations: { idempotentHint: true },
      },
      (args) =>
        toolResult(async () => {
          await this.guildAccess.assertOfficer(user.id, args.guildId);
          await this.attributes.setForCharacter(args.guildId, args.characterId, args.attributeIds);
          return { ok: true };
        }),
    );
  }

  private async assertMember(user: SessionUser, id: string): Promise<void> {
    if (!(await this.guildAccess.find(user.id, id))) {
      throw new ForbiddenException('You are not a member of this guild');
    }
  }
}

interface RosterFilters {
  query?: string;
  class?: string;
  race?: string;
  role?: Role;
  minLevel?: number;
  maxLevel?: number;
  discordUserId?: string;
  attribute?: string;
}

const searchWords = (query: string | undefined): string[] =>
  (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Whether a roster row passes every filter given (names and words ignore case). */
export function matches(character: RosterCharacter, filters: RosterFilters): boolean {
  const { player } = character;
  const names = [character.name, player.username, player.displayName];
  return (
    searchWords(filters.query).every((word) =>
      names.some((name) => name?.toLowerCase().includes(word)),
    ) &&
    (filters.class === undefined || same(character.class, filters.class)) &&
    (filters.race === undefined || same(character.race, filters.race)) &&
    (filters.role === undefined || character.roles.includes(filters.role)) &&
    (filters.minLevel === undefined || character.level >= filters.minLevel) &&
    (filters.maxLevel === undefined || character.level <= filters.maxLevel) &&
    (filters.discordUserId === undefined || player.discordUserId === filters.discordUserId) &&
    (filters.attribute === undefined ||
      character.attributes.some((name) => same(name, filters.attribute as string)))
  );
}

const ROLE_OF_LABEL = new Map(
  (Object.entries(ROLE_LABELS) as [Role, string][]).map(([value, label]) => [label, value]),
);

/** A guild's races, classes, specs and roles, as `get_character_options` gives them. */
export function characterOptions(gameVersion: string, faction: 'ALLIANCE' | 'HORDE') {
  const game = getGame(gameVersion);
  const rolesOf = (labels: readonly string[]): Role[] =>
    labels.map((label) => ROLE_OF_LABEL.get(label)).filter((r): r is Role => r !== undefined);
  return {
    gameVersion,
    faction,
    nameFormat: requiresLastName(gameVersion) ? 'Name-Lastname' : 'Name',
    races: racesOf(gameVersion, faction),
    classes: Object.entries(game?.classes ?? {}).map(([name, { specializations }]) => ({
      class: name,
      // Every role the class can play (all of them when the version doesn't say).
      roles: rolesOf(rolesOfClass(gameVersion, name)),
      specs: Object.entries(specializations).map(([spec, { roles }]) => ({
        spec,
        roles: rolesOf(roles),
      })),
    })),
    roles: Object.keys(ROLE_LABELS),
  };
}
