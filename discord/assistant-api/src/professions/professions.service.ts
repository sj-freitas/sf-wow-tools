import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GuildAccessService } from '../auth/guild-access.service';
import { PrismaService } from '../database/prisma.service';
import { getGame } from '../game/games';
import { attunementRows, type CharacterAttunementsDto } from './attunements';
import { matchCharacter, parseProfessionExport } from './profession-export';
import { fuzzyWordsScore } from './fuzzy';
import {
  byName,
  GuildRecipesService,
  type GuildProfessionsDto,
  type ProfessionDto,
} from './guild-recipes.service';
import { ProfessionsPostPlugin } from './professions-post.plugin';
import { RecipeSourcesService } from './recipe-sources.service';
import { WowheadService, type WowheadRef } from './wowhead.service';

export type { GuildProfessionsDto, ProfessionDto, RecipeDto } from './guild-recipes.service';
export type { CharacterAttunementsDto } from './attunements';

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

/** What an import writes to a character's profession. */
interface ProfessionWrite {
  skill: number | null;
  maxSkill: number | null;
  spellIds: number[];
  itemIds: number[];
  learnedAt: Date | null;
  recordedAt: Date | null;
  importedAt: Date;
}

/** What the database holds for one, of what an import compares against. */
interface StoredProfession {
  name: string;
  skill: number | null;
  maxSkill: number | null;
  spellIds: number[];
  itemIds: number[];
  learnedAt: Date | null;
  recordedAt: Date | null;
}

/** One profession an import will write (`row` null: the character no longer has it). */
interface ProfessionPlan {
  characterId: string;
  name: string;
  stored: StoredProfession | null;
  row: ProfessionWrite | null;
}

/** One raid's attunement an import will write. */
interface AttunementPlan {
  characterId: string;
  key: string;
  stored: { attuned: boolean } | null;
  attuned: boolean;
}

/** Rows of one import, by the character they belong to. */
const byCharacter = <T extends { characterId: string }>(rows: readonly T[]): Map<string, T[]> => {
  const by = new Map<string, T[]>();
  for (const row of rows) {
    const list = by.get(row.characterId);
    if (list) list.push(row);
    else by.set(row.characterId, [row]);
  }
  return by;
};

const professionPairs = (
  plans: readonly ProfessionPlan[],
): { characterId: string; name: string }[] =>
  plans.map(({ characterId, name }) => ({ characterId, name }));

const attunementPairs = (
  plans: readonly AttunementPlan[],
): { characterId: string; key: string }[] =>
  plans.map(({ characterId, key }) => ({ characterId, key }));

const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

const sameTime = (a: Date | null, b: Date | null): boolean =>
  a === null || b === null ? a === b : a.getTime() === b.getTime();

/**
 * Whether the database already holds what this import would write (bar when it was last imported).
 * An export is re-sent whole every time the game saves it, and almost all of it is what we have
 * already: those rows are left alone rather than written one by one.
 */
const holds = (stored: StoredProfession | null, row: ProfessionWrite | null): boolean =>
  stored !== null &&
  row !== null &&
  stored.skill === row.skill &&
  stored.maxSkill === row.maxSkill &&
  sameIds(stored.spellIds, row.spellIds) &&
  sameIds(stored.itemIds, row.itemIds) &&
  sameTime(stored.learnedAt, row.learnedAt) &&
  sameTime(stored.recordedAt, row.recordedAt);

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
    private readonly recipeSources: RecipeSourcesService,
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
    // Which of the export's characters are ours, worked out before the database is touched. An
    // export carries every character the uploader's addon knows (dozens, with a guild sharing), and
    // reading and writing one character at a time made an upload hundreds of round trips long —
    // longer than the uploader waits for an answer. What they all need is read, then written,
    // together.
    const matched: {
      exported: (typeof data.characters)[number];
      character: (typeof roster)[number];
      name: string;
    }[] = [];
    for (const exported of data.characters) {
      if (exported.source === 'link') {
        result.linked.push({ name: exported.name, realm: exported.realm });
        continue;
      }
      // Without the dates, newer and older can't be told apart: left out (not an error).
      if (data.format < 2) {
        result.outdated.push({ name: exported.name, realm: exported.realm });
        continue;
      }
      // A character the addon (1.0 or later) knows but recorded nothing for yet: nothing to import.
      if (exported.updated === null) continue;
      const character = matchCharacter(exported, own) ?? matchCharacter(exported, roster);
      if (!character) {
        result.skipped.push({ name: exported.name, realm: exported.realm });
        continue;
      }
      matched.push({
        exported,
        character,
        name: [character.firstName, character.lastName].filter(Boolean).join('-'),
      });
    }

    const ids = matched.map(({ character }) => character.id);
    const [keptRows, dropRows, snapshotRows, attunementRows] = await Promise.all([
      this.prisma.characterProfession.findMany({ where: { characterId: { in: ids } } }),
      this.prisma.professionDrop.findMany({ where: { characterId: { in: ids } } }),
      this.prisma.professionSnapshot.findMany({ where: { characterId: { in: ids } } }),
      this.prisma.characterAttunement.findMany({ where: { characterId: { in: ids } } }),
    ]);
    const keptOf = byCharacter(keptRows);
    const dropsOf = byCharacter(dropRows);
    const attunedOf = byCharacter(attunementRows);
    const snapshotOf = new Map(snapshotRows.map((row) => [row.characterId, row]));

    const at = this.now();
    /**
     * What to write, worked out in memory first. Two of the export's characters can be the same
     * character here (its own entry and a guildmate's copy of it), so each is kept by the row it
     * writes to and the second merges onto the first instead of writing twice.
     */
    const professions = new Map<string, ProfessionPlan>();
    const attunements = new Map<string, AttunementPlan>();
    /** The date of the newest export applied, for the characters this one is newer than. */
    const snapshots = new Map<string, Date>();
    /** Main professions dropped by this import (replaced in game), by character: name -> when. */
    const dropped = new Map<string, Map<string, Date>>();
    /** Professions the export says were learned again: their drop goes, by character. */
    const relearned = new Map<string, Set<string>>();

    for (const { exported, character, name } of matched) {
      const kept = keptOf.get(character.id) ?? [];
      const drops = dropsOf.get(character.id) ?? [];
      const snapshot = snapshotOf.get(character.id);
      // Not null: the characters without a date were left out above.
      const taken = exported.updated as Date;
      const newer = !snapshot || taken > snapshot.takenAt;

      if (newer) {
        for (const before of kept) {
          if (SECONDARY_PROFESSIONS.includes(before.name)) continue;
          if (exported.professions.some((p) => p.name === before.name)) continue;
          // Learned or changed after the export: it isn't what the export is about.
          const seen = later(before.learnedAt, before.recordedAt);
          if (seen && seen > taken) continue;
          professions.set(`${character.id}\t${before.name}`, {
            characterId: character.id,
            name: before.name,
            stored: before,
            row: null,
          });
          const now = dropped.get(character.id) ?? new Map<string, Date>();
          now.set(before.name, taken);
          dropped.set(character.id, now);
          result.replaced.push({ characterId: character.id, name, profession: before.name });
        }
      }

      const written: { name: string; recipes: number }[] = [];
      for (const profession of exported.professions) {
        const key = `${character.id}\t${profession.name}`;
        const droppedNow = dropped.get(character.id)?.get(profession.name);
        const drop = droppedNow
          ? { name: profession.name, droppedAt: droppedNow }
          : drops.find((d) => d.name === profession.name);
        if (drop && !relearned.get(character.id)?.has(profession.name)) {
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
          const back = relearned.get(character.id) ?? new Set<string>();
          back.add(profession.name);
          relearned.set(character.id, back);
        }
        const planned = professions.get(key);
        const stored = planned
          ? planned.stored
          : (kept.find((k) => k.name === profession.name) ?? null);
        // What to merge onto: what this import has written for it already (nothing, when it was
        // just dropped), else what the database holds.
        const before = planned ? planned.row : stored;
        const merged = {
          skill: higher(before?.skill, profession.skill),
          maxSkill: higher(before?.maxSkill, profession.max),
          spellIds: union(before?.spellIds ?? [], profession.spells),
          itemIds: union(before?.itemIds ?? [], profession.items),
          learnedAt: later(before?.learnedAt, profession.learned),
          recordedAt: later(before?.recordedAt, profession.updated),
          importedAt: at,
        };
        professions.set(key, {
          characterId: character.id,
          name: profession.name,
          stored,
          row: merged,
        });
        refs.push(...profession.spells.map((id) => ({ kind: 'SPELL' as const, id })));
        refs.push(...profession.items.map((id) => ({ kind: 'ITEM' as const, id })));
        written.push({
          name: profession.name,
          recipes: merged.spellIds.length + merged.itemIds.length,
        });
      }
      // Which raids it is attuned to (the addon 1.6.0 and later). Only ever gained: an attunement
      // is for good, so an older copy saying no doesn't take one back.
      for (const attunement of exported.attunements) {
        const key = `${character.id}\t${attunement.key}`;
        const planned = attunements.get(key);
        const stored = planned
          ? planned.stored
          : (attunedOf.get(character.id)?.find((row) => row.key === attunement.key) ?? null);
        attunements.set(key, {
          characterId: character.id,
          key: attunement.key,
          stored,
          attuned: attunement.attuned || (planned?.attuned ?? stored?.attuned ?? false),
        });
      }
      if (newer) {
        const applied = snapshots.get(character.id);
        if (!applied || taken > applied) snapshots.set(character.id, taken);
      }
      result.imported.push({
        characterId: character.id,
        name,
        relayed: exported.source === 'guild',
        professions: written,
      });
    }

    // The writes: a handful of statements for the whole export, whatever it carries. A row that
    // already holds what this import would write is only marked as seen again, all in one.
    const planned = [...professions.values()];
    const changed = planned.filter(({ stored, row }) => row === null || !holds(stored, row));
    const gone = changed.filter(({ stored }) => stored !== null);
    const fresh = changed.filter(
      (plan): plan is ProfessionPlan & { row: ProfessionWrite } => plan.row !== null,
    );
    const seenAgain = planned.filter(({ stored, row }) => row !== null && holds(stored, row));
    if (gone.length > 0) {
      await this.prisma.characterProfession.deleteMany({
        where: { OR: professionPairs(gone) },
      });
    }
    if (fresh.length > 0) {
      // skipDuplicates: two players' uploads can carry the same guildmate, and writing a row the
      // other one made in the meantime would fail the whole upload. Leaving theirs standing costs
      // nothing: the next upload merges onto it.
      await this.prisma.characterProfession.createMany({
        data: fresh.map(({ characterId, name, row }) => ({ characterId, name, ...row })),
        skipDuplicates: true,
      });
    }
    if (seenAgain.length > 0) {
      await this.prisma.characterProfession.updateMany({
        where: { OR: professionPairs(seenAgain) },
        data: { importedAt: at },
      });
    }

    const raids = [...attunements.values()];
    const turned = raids.filter(
      ({ stored, attuned }) => stored === null || stored.attuned !== attuned,
    );
    const rewritten = turned.filter(({ stored }) => stored !== null);
    if (rewritten.length > 0) {
      await this.prisma.characterAttunement.deleteMany({
        where: { OR: attunementPairs(rewritten) },
      });
    }
    if (turned.length > 0) {
      await this.prisma.characterAttunement.createMany({
        data: turned.map(({ characterId, key, attuned }) => ({
          characterId,
          key,
          attuned,
          recordedAt: at,
        })),
        skipDuplicates: true,
      });
    }
    const told = raids.filter(
      ({ stored, attuned }) => stored !== null && stored.attuned === attuned,
    );
    if (told.length > 0) {
      await this.prisma.characterAttunement.updateMany({
        where: { OR: attunementPairs(told) },
        data: { recordedAt: at },
      });
    }

    if (snapshots.size > 0) {
      const rows = [...snapshots].map(([characterId, takenAt]) => ({ characterId, takenAt }));
      await this.prisma.professionSnapshot.deleteMany({
        where: { characterId: { in: rows.map((row) => row.characterId) } },
      });
      await this.prisma.professionSnapshot.createMany({ data: rows, skipDuplicates: true });
    }

    // A character whose drops changed has them rewritten: its last two (it has two main ones).
    const dropChanged = new Set([...dropped.keys(), ...relearned.keys()]);
    if (dropChanged.size > 0) {
      const rows: { characterId: string; name: string; droppedAt: Date }[] = [];
      for (const characterId of dropChanged) {
        const back = relearned.get(characterId) ?? new Set<string>();
        const now = dropped.get(characterId) ?? new Map<string, Date>();
        rows.push(
          ...[
            ...(dropsOf.get(characterId) ?? [])
              .filter((drop) => !back.has(drop.name) && !now.has(drop.name))
              .map((drop) => ({ characterId, name: drop.name, droppedAt: drop.droppedAt })),
            ...[...now].map(([name, droppedAt]) => ({ characterId, name, droppedAt })),
          ]
            .sort((a, b) => b.droppedAt.getTime() - a.droppedAt.getTime())
            .slice(0, 2),
        );
      }
      await this.prisma.professionDrop.deleteMany({
        where: { characterId: { in: [...dropChanged] } },
      });
      if (rows.length > 0) {
        await this.prisma.professionDrop.createMany({ data: rows, skipDuplicates: true });
      }
    }
    // Names are looked up in the background: the import doesn't wait for Wowhead.
    void this.wowhead.resolve(refs, path);
    // The guild's Professions Lists post the change.
    if (result.imported.length > 0) await this.professionsPost.soon(guildId);
    // How recipes are obtained, as the addon saw it (1.3.0+): gathered for GuildAssistant Database.
    await this.recipeSources.record(user.id, data.sources);
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
   * Which raids a character is attuned to, for its page (guild-agnostic, like its professions): every
   * raid known, each attuned, not attuned or not looked at by anyone's addon yet.
   */
  async attunementsOf(characterId: string): Promise<CharacterAttunementsDto> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true },
    });
    if (!character) throw new NotFoundException('No such character.');
    const stored = await this.prisma.characterAttunement.findMany({
      where: { characterId },
      select: { key: true, attuned: true, recordedAt: true },
    });
    return attunementRows(stored);
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
    if (character.player?.discordUserId !== user.discordId) {
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
