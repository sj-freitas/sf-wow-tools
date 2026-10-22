import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

/** Secondary professions: everyone can have them all, so they aren't dropped (main ones are). */
export const SECONDARY_PROFESSIONS: readonly string[] = ['Cooking', 'First Aid', 'Fishing'];

export interface ImportResultDto {
  imported: {
    characterId: string;
    name: string;
    /** A guildmate's, from the uploader's addon (guild sharing), not one of the uploader's own. */
    relayed: boolean;
    professions: { name: string; recipes: number }[];
  }[];
  /**
   * Characters of the export not imported: one of "own" that isn't (unambiguously) one of the
   * user's in this guild, or a guildmate's that isn't on the guild's roster.
   */
  skipped: { name: string; realm: string }[];
  /** Other players' characters, seen through profession links: not imported (yet). */
  linked: { name: string; realm: string }[];
  /**
   * Characters from an older addon (before 1.0: no dates by the game server, so which data is
   * newer can't be told): left out, quietly. Updating the addon and uploading again imports them.
   */
  outdated: { name: string; realm: string }[];
  /**
   * Professions dropped from a character that the export still has, but from before the drop (an
   * old copy): left out.
   */
  dropped: { characterId: string; name: string; profession: string; droppedAt: string }[];
  /** Dropped before, but learned again since (the export says): added back. */
  relearned: { characterId: string; name: string; profession: string }[];
  /**
   * Main professions the character had here that this newer export no longer has (unlearned and
   * replaced in game): dropped.
   */
  replaced: { characterId: string; name: string; profession: string }[];
}

/** Each recipe id once, sorted. */
const union = (a: readonly number[], b: readonly number[]): number[] =>
  [...new Set([...a, ...b])].sort((x, y) => x - y);
const higher = (a: number | null | undefined, b: number | null): number | null =>
  a == null ? b : b == null ? a : Math.max(a, b);
const later = (a: Date | null | undefined, b: Date | null): Date | null =>
  !a ? b : !b ? a : a > b ? a : b;

/** A recipe /crafter found, and who can craft it (their player's Discord id, for a mention). */
export interface CrafterMatch {
  name: string;
  url: string;
  profession: string;
  crafters: { name: string; discordUserId: string | null }[];
}

/**
 * Characters' professions, imported from the GuildAssistant Professions addon. A player imports
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

  /** For tests: the time now (a drop by hand is dated by it). */
  now: () => Date = () => new Date();

  /**
   * Imports an export. Whoever uploads it, the most recent data about a character wins (the
   * export's `updated` for it, its last change in game):
   * - A newer export than the last one applied decides which main professions the character has:
   *   one it doesn't list, and nothing about which is newer than the export, was unlearned (say
   *   Blacksmithing for Engineering): it's dropped, as of the export's date.
   * - A dropped profession comes back only if the export says it was learned again after the
   *   drop; an older copy that still has it leaves it out.
   * - Within a profession, recipes are only ever added (merged), skill and dates keep the higher.
   * The characters are matched by name: the user's own first, then the guild's roster (a
   * guildmate's, shared by their addon). Characters from an addon before 1.0 (no dates) are left
   * out, quietly (`outdated`).
   */
  async import(
    user: { id: string; discordId: string },
    guildId: string,
    input: unknown,
  ): Promise<ImportResultDto> {
    await this.assertMember(user.id, guildId);
    const data = parseProfessionExport(input);
    const path = await this.guildRecipes.wowheadPath(guildId);
    const select = { id: true, firstName: true, lastName: true, realm: true } as const;
    const [own, roster] = await Promise.all([
      this.prisma.character.findMany({
        where: { player: { discordUserId: user.discordId }, guilds: { some: { guildId } } },
        select,
      }),
      this.prisma.character.findMany({ where: { guilds: { some: { guildId } } }, select }),
    ]);

    const result: ImportResultDto = {
      imported: [],
      skipped: [],
      linked: [],
      outdated: [],
      dropped: [],
      relearned: [],
      replaced: [],
    };
    const refs: WowheadRef[] = [];
    for (const exported of data.characters) {
      if (exported.source === 'link') {
        result.linked.push({ name: exported.name, realm: exported.realm });
        continue;
      }
      // Without the dates, newer and older can't be told apart: left out (not an error).
      if (data.format < 2 || exported.updated === null) {
        result.outdated.push({ name: exported.name, realm: exported.realm });
        continue;
      }
      const character = matchCharacter(exported, own) ?? matchCharacter(exported, roster);
      if (!character) {
        result.skipped.push({ name: exported.name, realm: exported.realm });
        continue;
      }
      const name = [character.firstName, character.lastName].filter(Boolean).join('-');
      const [kept, drops, snapshot] = await Promise.all([
        this.prisma.characterProfession.findMany({ where: { characterId: character.id } }),
        this.prisma.professionDrop.findMany({ where: { characterId: character.id } }),
        this.prisma.professionSnapshot.findUnique({ where: { characterId: character.id } }),
      ]);
      const taken = exported.updated;
      const newer = !snapshot || taken > snapshot.takenAt;

      if (newer) {
        for (const before of kept) {
          if (SECONDARY_PROFESSIONS.includes(before.name)) continue;
          if (exported.professions.some((p) => p.name === before.name)) continue;
          // Learned or changed after the export: it isn't what the export is about.
          const seen = later(before.learnedAt, before.recordedAt);
          if (seen && seen > taken) continue;
          await this.prisma.characterProfession.deleteMany({
            where: { characterId: character.id, name: before.name },
          });
          await this.recordDrop(character.id, before.name, taken);
          result.replaced.push({ characterId: character.id, name, profession: before.name });
        }
      }

      const written: { name: string; recipes: number }[] = [];
      for (const profession of exported.professions) {
        const drop = drops.find((d) => d.name === profession.name);
        if (drop) {
          if (profession.learned === null || profession.learned <= drop.droppedAt) {
            result.dropped.push({
              characterId: character.id,
              name,
              profession: profession.name,
              droppedAt: drop.droppedAt.toISOString(),
            });
            continue;
          }
          result.relearned.push({ characterId: character.id, name, profession: profession.name });
          await this.prisma.professionDrop.delete({
            where: { characterId_name: { characterId: character.id, name: profession.name } },
          });
        }
        const before = kept.find((k) => k.name === profession.name);
        const merged = {
          skill: higher(before?.skill, profession.skill),
          maxSkill: higher(before?.maxSkill, profession.max),
          spellIds: union(before?.spellIds ?? [], profession.spells),
          itemIds: union(before?.itemIds ?? [], profession.items),
          learnedAt: later(before?.learnedAt, profession.learned),
          recordedAt: later(before?.recordedAt, profession.updated),
          importedAt: this.now(),
        };
        await this.prisma.characterProfession.upsert({
          where: { characterId_name: { characterId: character.id, name: profession.name } },
          create: { characterId: character.id, name: profession.name, ...merged },
          update: merged,
        });
        refs.push(...profession.spells.map((id) => ({ kind: 'SPELL' as const, id })));
        refs.push(...profession.items.map((id) => ({ kind: 'ITEM' as const, id })));
        written.push({
          name: profession.name,
          recipes: merged.spellIds.length + merged.itemIds.length,
        });
      }
      if (newer) {
        await this.prisma.professionSnapshot.upsert({
          where: { characterId: character.id },
          create: { characterId: character.id, takenAt: taken },
          update: { takenAt: taken },
        });
      }
      result.imported.push({
        characterId: character.id,
        name,
        relayed: exported.source === 'guild',
        professions: written,
      });
    }
    // Names are looked up in the background: the import doesn't wait for Wowhead.
    void this.wowhead.resolve(refs, path);
    // The guild's Professions Lists post the change.
    if (result.imported.length > 0) await this.professionsPost.soon(guildId);
    return result;
  }

  /**
   * Remembers a main profession dropped from a character, as of `at`, so an import (which only
   * adds) doesn't bring it back from an old copy. Its last two (a character has two main ones).
   */
  private async recordDrop(characterId: string, name: string, at: Date): Promise<void> {
    await this.prisma.professionDrop.upsert({
      where: { characterId_name: { characterId, name } },
      create: { characterId, name, droppedAt: at },
      update: { droppedAt: at },
    });
    const older = await this.prisma.professionDrop.findMany({
      where: { characterId },
      orderBy: { droppedAt: 'desc' },
      skip: 2,
      select: { name: true },
    });
    if (older.length > 0) {
      await this.prisma.professionDrop.deleteMany({
        where: { characterId, name: { in: older.map((d) => d.name) } },
      });
    }
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

  /**
   * "Drop this profession" on a character's page: deletes it and its recipes. Its own player, or
   * an Officer of a guild it is in (even when the character is verified on Battle.net). Only main
   * professions: the secondary ones (SECONDARY_PROFESSIONS) can't be dropped. The guilds'
   * Professions Lists post the change soon after.
   */
  async drop(
    user: { id: string; discordId: string },
    characterId: string,
    name: string,
  ): Promise<void> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: {
        player: { select: { discordUserId: true } },
        guilds: { select: { guildId: true } },
      },
    });
    if (!character) throw new NotFoundException('Character not found');
    if (SECONDARY_PROFESSIONS.includes(name)) {
      throw new BadRequestException(`${name} is a secondary profession: it can't be dropped.`);
    }
    if (character.player.discordUserId !== user.discordId) {
      const accesses = await Promise.all(
        character.guilds.map(({ guildId }) => this.guildAccess.find(user.id, guildId)),
      );
      if (!accesses.some((access) => access?.isOfficer)) {
        throw new ForbiddenException(
          'Only its player, or an Officer of a guild it is in, can drop its professions.',
        );
      }
    }
    const { count } = await this.prisma.characterProfession.deleteMany({
      where: { characterId, name },
    });
    if (count === 0) throw new NotFoundException(`It has no ${name} to drop.`);
    await this.recordDrop(characterId, name, this.now());
    for (const { guildId } of character.guilds) await this.professionsPost.soon(guildId);
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

  /** The user's access to the guild (they must be in it). */
  private async assertMember(userId: string, guildId: string) {
    const access = await this.guildAccess.find(userId, guildId);
    if (!access) throw new ForbiddenException('You are not a member of this guild');
    return access;
  }
}
