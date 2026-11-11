import { Controller, Get, Injectable } from '@nestjs/common';
import type { RecipeSourceKind } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { ExportedSources } from './profession-export';

/** At most this many users are remembered per source: enough to count them. */
const MAX_REPORTERS = 20;
/** Sources looked up at once (a query's OR list). */
const CHUNK = 200;

export interface RecipeSourceEntryDto {
  /** As the addon writes it: "V:Tanaris=Krinkle Goodsteel", "Stormwind City=Grimand Elmore". */
  entry: string;
  /** How many users' imports reported it. */
  reporters: number;
  lastSeen: string;
}

/** Everything gathered, for GuildAssistant Database's data build (addons/scripts/database). */
export interface RecipeSourcesDto {
  /** Recipe items and where each comes from. */
  items: { id: number; entries: RecipeSourceEntryDto[] }[];
  /** Recipes trainers teach ("item:<item made>" or "name:<recipe>"), with the cost seen. */
  trainers: { recipe: string; cost: number | null; entries: RecipeSourceEntryDto[] }[];
}

interface Row {
  kind: RecipeSourceKind;
  key: string;
  entry: string;
  cost: number | null;
}

const rowKey = (row: Pick<Row, 'kind' | 'key' | 'entry'>) =>
  `${row.kind}\t${row.key}\t${row.entry}`;

/**
 * How recipes are obtained, as players' GuildAssistant Professions addons saw it in game (vendors,
 * trainers and their costs, loot, quest rewards; addons/GuildAssistantProfessions/Sources.lua).
 * Each import adds what its export carries (merged, never replaced), and everything gathered is
 * published for GuildAssistant Database's next data build, which a person reviews before it ships.
 */
@Injectable()
export class RecipeSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  /** For tests: the time now. */
  now = () => new Date();

  /** Adds what an import's export carries, reported by `userId`. Returns how many were new. */
  async record(userId: string, sources: ExportedSources | null | undefined): Promise<number> {
    if (!sources) return 0;
    const rows: Row[] = [
      ...sources.items.flatMap((item) =>
        item.entries.map((entry) => ({
          kind: 'ITEM' as const,
          key: String(item.id),
          entry,
          cost: null,
        })),
      ),
      ...sources.trainers.flatMap((trainer) =>
        trainer.entries.map((entry) => ({
          kind: 'TRAINER' as const,
          key: trainer.recipe,
          entry,
          cost: trainer.cost,
        })),
      ),
    ];
    const now = this.now();
    let added = 0;
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK);
      const existing = new Map(
        (
          await this.prisma.recipeSource.findMany({
            where: { OR: chunk.map(({ kind, key, entry }) => ({ kind, key, entry })) },
          })
        ).map((row) => [rowKey(row), row]),
      );
      const fresh = chunk.filter((row) => !existing.has(rowKey(row)));
      if (fresh.length > 0) {
        added += (
          await this.prisma.recipeSource.createMany({
            data: fresh.map((row) => ({
              ...row,
              reporters: [userId],
              firstSeenAt: now,
              lastSeenAt: now,
            })),
            skipDuplicates: true,
          })
        ).count;
      }
      for (const row of chunk) {
        const known = existing.get(rowKey(row));
        if (!known) continue;
        const reporters =
          known.reporters.includes(userId) || known.reporters.length >= MAX_REPORTERS
            ? known.reporters
            : [...known.reporters, userId];
        await this.prisma.recipeSource.update({
          where: { kind_key_entry: { kind: row.kind, key: row.key, entry: row.entry } },
          data: { lastSeenAt: now, reporters, ...(row.cost !== null ? { cost: row.cost } : {}) },
        });
      }
    }
    return added;
  }

  /** Everything gathered, by item and by recipe, sorted. */
  async published(): Promise<RecipeSourcesDto> {
    const rows = await this.prisma.recipeSource.findMany({
      orderBy: [{ kind: 'asc' }, { key: 'asc' }, { entry: 'asc' }],
    });
    const items = new Map<number, RecipeSourcesDto['items'][number]>();
    const trainers = new Map<string, RecipeSourcesDto['trainers'][number]>();
    for (const row of rows) {
      const entry = {
        entry: row.entry,
        reporters: row.reporters.length,
        lastSeen: row.lastSeenAt.toISOString(),
      };
      if (row.kind === 'ITEM') {
        const id = Number(row.key);
        if (!items.has(id)) items.set(id, { id, entries: [] });
        items.get(id)!.entries.push(entry);
      } else {
        if (!trainers.has(row.key))
          trainers.set(row.key, { recipe: row.key, cost: null, entries: [] });
        const trainer = trainers.get(row.key)!;
        trainer.cost = row.cost ?? trainer.cost;
        trainer.entries.push(entry);
      }
    }
    return {
      items: [...items.values()].sort((a, b) => a.id - b.id),
      trainers: [...trainers.values()].sort((a, b) => a.recipe.localeCompare(b.recipe)),
    };
  }
}

/**
 * GET /api/recipe-sources: everything players' addons found of how recipes are obtained. No login
 * needed: game facts (vendors, trainers, zones), no player or guild in them.
 */
@Controller('recipe-sources')
export class RecipeSourcesController {
  constructor(private readonly sources: RecipeSourcesService) {}

  @Get()
  list(): Promise<RecipeSourcesDto> {
    return this.sources.published();
  }
}
