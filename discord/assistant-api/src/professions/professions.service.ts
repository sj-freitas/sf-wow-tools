import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GuildAccessService } from '../auth/guild-access.service';
import { PrismaService } from '../database/prisma.service';
import { getGame } from '../game/games';
import { matchCharacter, parseProfessionExport } from './profession-export';
import { fuzzyWordsScore } from './fuzzy';
import {
  byName,
  GuildRecipesService,
  type GuildProfessionsDto,
  type ProfessionDto,
} from './guild-recipes.service';
import { ProfessionsPostPlugin } from './professions-post.plugin';
import { WowheadService, type WowheadRef } from './wowhead.service';

export type { GuildProfessionsDto, ProfessionDto, RecipeDto } from './guild-recipes.service';

export interface ImportResultDto {
  imported: {
    characterId: string;
    name: string;
    professions: { name: string; recipes: number }[];
  }[];
  /** Characters of the export that aren't (unambiguously) one of the user's in this guild. */
  skipped: { name: string; realm: string }[];
  /** Other players' characters, seen through profession links: not imported (yet). */
  linked: { name: string; realm: string }[];
}

/** A recipe /crafter found, and who can craft it (their player's Discord id, for a mention). */
export interface CrafterMatch {
  name: string;
  url: string;
  profession: string;
  crafters: { name: string; discordUserId: string | null }[];
}

/**
 * Characters' professions, imported from the Guild Assistant Professions addon. A player imports
 * for their own characters in a guild (matched by name); everyone in the guild can see them. Recipe
 * names come from Wowhead (WowheadService), looked up after an import and whenever still missing.
 */
@Injectable()
export class ProfessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guildAccess: GuildAccessService,
    private readonly wowhead: WowheadService,
    private readonly guildRecipes: GuildRecipesService,
    private readonly professionsPost: ProfessionsPostPlugin,
  ) {}

  async import(
    user: { id: string; discordId: string },
    guildId: string,
    input: unknown,
  ): Promise<ImportResultDto> {
    await this.assertMember(user.id, guildId);
    const data = parseProfessionExport(input);
    const path = await this.guildRecipes.wowheadPath(guildId);
    const own = await this.prisma.character.findMany({
      where: { player: { discordUserId: user.discordId }, guilds: { some: { guildId } } },
      select: { id: true, firstName: true, lastName: true, realm: true },
    });

    const result: ImportResultDto = { imported: [], skipped: [], linked: [] };
    const refs: WowheadRef[] = [];
    for (const exported of data.characters) {
      if (exported.source === 'link') {
        result.linked.push({ name: exported.name, realm: exported.realm });
        continue;
      }
      const character = matchCharacter(exported, own);
      if (!character) {
        result.skipped.push({ name: exported.name, realm: exported.realm });
        continue;
      }
      // The export is the whole truth about the character: professions it no longer has go.
      await this.prisma.$transaction([
        this.prisma.characterProfession.deleteMany({ where: { characterId: character.id } }),
        this.prisma.characterProfession.createMany({
          data: exported.professions.map((profession) => ({
            characterId: character.id,
            name: profession.name,
            skill: profession.skill,
            maxSkill: profession.max,
            spellIds: profession.spells,
            itemIds: profession.items,
          })),
        }),
      ]);
      for (const profession of exported.professions) {
        refs.push(...profession.spells.map((id) => ({ kind: 'SPELL' as const, id })));
        refs.push(...profession.items.map((id) => ({ kind: 'ITEM' as const, id })));
      }
      result.imported.push({
        characterId: character.id,
        name: [character.firstName, character.lastName].filter(Boolean).join('-'),
        professions: exported.professions.map((profession) => ({
          name: profession.name,
          recipes: profession.spells.length + profession.items.length,
        })),
      });
    }
    // Names are looked up in the background: the import doesn't wait for Wowhead.
    void this.wowhead.resolve(refs, path);
    // The guild's Professions Lists post the change.
    if (result.imported.length > 0) await this.professionsPost.soon(guildId);
    return result;
  }

  /** A character's professions with their recipes, for anyone in the guild. */
  async list(userId: string, guildId: string, characterId: string): Promise<ProfessionDto[]> {
    await this.assertMember(userId, guildId);
    const membership = await this.prisma.characterGuildMembership.findUnique({
      where: { characterId_guildId: { characterId, guildId } },
      select: { guild: { select: { gameVersion: true } } },
    });
    if (!membership) throw new NotFoundException('That character is not in this guild.');
    return this.professionsOf(characterId, membership.guild.gameVersion);
  }

  /**
   * A character's professions on its own page (guild-agnostic): any logged-in user may see them,
   * like the rest of the page.
   */
  async forCharacter(characterId: string): Promise<ProfessionDto[]> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { gameVersion: true },
    });
    if (!character) throw new NotFoundException('Character not found');
    return this.professionsOf(characterId, character.gameVersion);
  }

  /** The character's professions and recipes, linked to Wowhead in its game version's data. */
  private async professionsOf(characterId: string, gameVersion: string): Promise<ProfessionDto[]> {
    const path = getGame(gameVersion)?.wowheadPath ?? 'classic';
    const professions = await this.prisma.characterProfession.findMany({
      where: { characterId },
      orderBy: { name: 'asc' },
    });
    const refs: WowheadRef[] = professions.flatMap((profession) => [
      ...profession.spellIds.map((id) => ({ kind: 'SPELL' as const, id })),
      ...profession.itemIds.map((id) => ({ kind: 'ITEM' as const, id })),
    ]);
    const recipe = await this.guildRecipes.describe(refs, path);
    return professions.map((profession) => ({
      name: profession.name,
      skill: profession.skill,
      maxSkill: profession.maxSkill,
      importedAt: profession.importedAt.toISOString(),
      recipes: [
        ...profession.spellIds.map((id) => recipe('SPELL', id)),
        ...profession.itemIds.map((id) => recipe('ITEM', id)),
      ].sort(byName),
    }));
  }

  /** Every character's professions in the guild, and each recipe with who can craft it. */
  async guild(userId: string, guildId: string): Promise<GuildProfessionsDto> {
    await this.assertMember(userId, guildId);
    const { characters, recipes } = await this.guildRecipes.guildRecipes(guildId);
    return { characters, recipes };
  }

  /**
   * /crafter: who in the Discord server's guild can craft a recipe, found by name the way the
   * Professions page's search does (typos allowed), or by its id or Wowhead link
   * ("spell=1245287"). The best matches first, at most `limit`; `more` is how many were left out.
   * Null when the server has no guild.
   */
  async findCrafters(
    discordServerId: string,
    query: string,
    limit = 10,
  ): Promise<{ matches: CrafterMatch[]; more: number } | null> {
    const guild = await this.prisma.guild.findFirst({
      where: { servers: { some: { discordId: discordServerId } } },
      select: { id: true },
    });
    if (!guild) return null;
    const { recipes, characters, owners } = await this.guildRecipes.guildRecipes(guild.id);
    const byId = /(?:(spell|item)=)?(\d+)/.exec(query.trim());
    const isId = byId !== null && (byId[1] !== undefined || /^\d+$/.test(query.trim()));
    const scored = recipes
      .map((recipe) => {
        if (isId) {
          const matches = recipe.id === Number(byId[2]) && (!byId[1] || byId[1] === recipe.kind);
          return { recipe, score: matches ? 0 : null };
        }
        return { recipe, score: recipe.name ? fuzzyWordsScore(query, [recipe.name]) : null };
      })
      .filter(
        (entry): entry is { recipe: (typeof recipes)[number]; score: number } =>
          entry.score !== null,
      )
      .sort((a, b) => a.score - b.score || byName(a.recipe, b.recipe));
    const names = new Map(characters.map((c) => [c.id, c.name]));
    return {
      matches: scored.slice(0, limit).map(({ recipe }) => ({
        name: recipe.name ?? `${recipe.kind === 'spell' ? 'Spell' : 'Item'} ${recipe.id}`,
        url: recipe.url,
        profession: recipe.profession,
        crafters: recipe.crafterIds
          .map((id) => ({ name: names.get(id) ?? '?', discordUserId: owners.get(id) ?? null }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
      more: Math.max(0, scored.length - limit),
    };
  }

  private async assertMember(userId: string, guildId: string): Promise<void> {
    if (!(await this.guildAccess.find(userId, guildId))) {
      throw new ForbiddenException('You are not a member of this guild');
    }
  }
}
