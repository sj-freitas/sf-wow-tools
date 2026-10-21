import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { getGame } from '../game/games';
import { wowheadUrl } from './profession-export';
import { WowheadService, type WowheadRef } from './wowhead.service';

export interface RecipeDto {
  kind: 'spell' | 'item';
  id: number;
  /** English name from Wowhead; null until looked up (or unknown to Wowhead). */
  name: string | null;
  icon: string | null;
  url: string;
}

export interface ProfessionDto {
  name: string;
  skill: number | null;
  maxSkill: number | null;
  importedAt: string;
  recipes: RecipeDto[];
}

/** Everyone's professions in a guild: the characters, and every recipe with who can craft it. */
export interface GuildProfessionsDto {
  characters: {
    id: string;
    name: string;
    /** For the character's page address. */
    firstName: string;
    lastName: string;
    class: string;
    /** Its player on Discord: id, and display name or username (null until known). */
    discordUserId: string | null;
    discordName: string | null;
    professions: {
      name: string;
      skill: number | null;
      maxSkill: number | null;
      importedAt: string;
    }[];
  }[];
  /** One per profession and recipe (a recipe two professions share is listed under each). */
  recipes: (RecipeDto & { profession: string; crafterIds: string[] })[];
}

/** The guild's recipes, as GuildRecipesService.guildRecipes gives them. */
export type GuildRecipe = GuildProfessionsDto['recipes'][number];

/** Recipes by name, the ones Wowhead hasn't named (yet) last, by id. */
export const byName = (a: RecipeDto, b: RecipeDto): number =>
  a.name === null || b.name === null
    ? Number(a.name === null) - Number(b.name === null) || a.id - b.id
    : a.name.localeCompare(b.name) || a.id - b.id;

/**
 * A guild's professions as everyone sees them: its characters with professions, every recipe with
 * who can craft it, named from Wowhead. No login needed, so the bot and the worker (the Professions
 * List plugin) use it as well as the website.
 */
@Injectable()
export class GuildRecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wowhead: WowheadService,
  ) {}

  /** The guild's characters with professions, its recipes and who crafts them, and their players. */
  async guildRecipes(
    guildId: string,
  ): Promise<GuildProfessionsDto & { owners: Map<string, string> }> {
    const path = await this.wowheadPath(guildId);
    const rows = await this.prisma.characterProfession.findMany({
      where: { character: { guilds: { some: { guildId } } } },
      include: {
        character: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            class: true,
            player: {
              select: { discordUserId: true, discordDisplayName: true, discordUsername: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    // Each character's player's Discord id, for /crafter.
    const owners = new Map<string, string>();
    const characters = new Map<string, GuildProfessionsDto['characters'][number]>();
    const crafters = new Map<
      string,
      { profession: string; kind: 'SPELL' | 'ITEM'; id: number; ids: string[] }
    >();
    for (const row of rows) {
      const { character } = row;
      if (character.player) owners.set(character.id, character.player.discordUserId);
      let entry = characters.get(character.id);
      if (!entry) {
        entry = {
          id: character.id,
          name: [character.firstName, character.lastName].filter(Boolean).join(' '),
          firstName: character.firstName,
          lastName: character.lastName,
          class: character.class,
          discordUserId: character.player?.discordUserId ?? null,
          discordName:
            character.player?.discordDisplayName ?? character.player?.discordUsername ?? null,
          professions: [],
        };
        characters.set(character.id, entry);
      }
      entry.professions.push({
        name: row.name,
        skill: row.skill,
        maxSkill: row.maxSkill,
        importedAt: row.importedAt.toISOString(),
      });
      const add = (kind: 'SPELL' | 'ITEM', id: number) => {
        const key = `${row.name}|${kind}:${id}`;
        const recipe = crafters.get(key) ?? { profession: row.name, kind, id, ids: [] };
        recipe.ids.push(character.id);
        crafters.set(key, recipe);
      };
      for (const id of row.spellIds) add('SPELL', id);
      for (const id of row.itemIds) add('ITEM', id);
    }
    const all = [...crafters.values()];
    const recipe = await this.describe(all, path);
    return {
      characters: [...characters.values()].sort((a, b) => a.name.localeCompare(b.name)),
      recipes: all
        .map((entry) => ({
          ...recipe(entry.kind, entry.id),
          profession: entry.profession,
          crafterIds: entry.ids,
        }))
        .sort((a, b) => a.profession.localeCompare(b.profession) || byName(a, b)),
      owners,
    };
  }

  /**
   * How to show these recipes: Wowhead's name, icon and link, from the cache. Ones still unnamed
   * (new, or Wowhead was slow or down) are looked up again, in the background.
   */
  async describe(
    refs: readonly WowheadRef[],
    path: string,
  ): Promise<(kind: 'SPELL' | 'ITEM', id: number) => RecipeDto> {
    const cached = await this.wowhead.cached(refs);
    if (refs.some((ref) => !cached.get(`${ref.kind}:${ref.id}`)?.englishName)) {
      void this.wowhead.resolve(refs, path);
    }
    return (kind, id) => {
      const row = cached.get(`${kind}:${id}`);
      const name = row?.englishName ?? null;
      const lower = kind === 'SPELL' ? 'spell' : 'item';
      return {
        kind: lower,
        id,
        name,
        icon: row?.icon ?? null,
        url: wowheadUrl(path, lower, id, name),
      };
    };
  }

  /** The guild's game version's part of Wowhead's addresses ("forever"), "classic" otherwise. */
  async wowheadPath(guildId: string): Promise<string> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { gameVersion: true },
    });
    return (guild && getGame(guild.gameVersion)?.wowheadPath) ?? 'classic';
  }
}
