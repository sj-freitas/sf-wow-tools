import { Injectable, Logger } from '@nestjs/common';
import type { WowheadEntry, WowheadKind } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Wowhead's tooltip data (not an official API): name and icon of a spell or item, as JSON, in a
 * game version's data (`wowheadPath`, e.g. "forever": its own spells aren't in "classic").
 */
const TOOLTIP_URL = (path: string, kind: 'spell' | 'item', id: number) =>
  `https://nether.wowhead.com/${path}/tooltip/${kind}/${id}`;
const REQUEST_TIMEOUT_MS = 8000;
const CONCURRENCY = 4;
/** At most this many lookups per call; the rest are done the next time they are asked for. */
const MAX_LOOKUPS = 400;
/** A lookup that failed (not "no such id") is tried again after this long. */
const RETRY_AFTER_MS = 60 * 60 * 1000;

export interface WowheadRef {
  kind: WowheadKind;
  id: number;
}

const keyOf = (ref: WowheadRef) => `${ref.kind}:${ref.id}`;

/**
 * Names (and icons) of WoW spells and items, from Wowhead, kept in `wowhead_entries` once known:
 * names don't change, so each id is looked up once. Lookups run a few at a time; an id Wowhead
 * doesn't have is marked missing and not asked again; any other failure is retried later.
 */
@Injectable()
export class WowheadService {
  private readonly logger = new Logger(WowheadService.name);
  private readonly inFlight = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  /** For tests: how requests are made. */
  fetcher: typeof fetch = (input, init) => fetch(input, init);

  /** What is cached for these ids, by `KIND:id`. */
  async cached(refs: readonly WowheadRef[]): Promise<Map<string, WowheadEntry>> {
    const byKind = (kind: WowheadKind) => refs.filter((ref) => ref.kind === kind).map((r) => r.id);
    const rows = await this.prisma.wowheadEntry.findMany({
      where: {
        OR: [
          { kind: 'SPELL', id: { in: byKind('SPELL') } },
          { kind: 'ITEM', id: { in: byKind('ITEM') } },
        ],
      },
    });
    return new Map(rows.map((row) => [keyOf(row), row]));
  }

  /**
   * Looks up the ids that have no name yet (and weren't just tried), in Wowhead's data for `path`
   * (the guild's game version). Never throws.
   */
  async resolve(refs: readonly WowheadRef[], path: string): Promise<void> {
    try {
      const cached = await this.cached(refs);
      const now = Date.now();
      const todo = refs
        .filter((ref) => {
          const row = cached.get(keyOf(ref));
          if (this.inFlight.has(keyOf(ref))) return false;
          if (!row) return true;
          if (row.englishName || row.missing) return false;
          return !row.fetchedAt || now - row.fetchedAt.getTime() > RETRY_AFTER_MS;
        })
        .slice(0, MAX_LOOKUPS);
      for (const ref of todo) this.inFlight.add(keyOf(ref));
      try {
        let next = 0;
        const worker = async () => {
          while (next < todo.length) await this.lookup(todo[next++], path);
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      } finally {
        for (const ref of todo) this.inFlight.delete(keyOf(ref));
      }
    } catch (error) {
      this.logger.warn(`Wowhead lookups failed: ${String(error)}`);
    }
  }

  private async lookup(ref: WowheadRef, path: string): Promise<void> {
    const kind = ref.kind === 'SPELL' ? 'spell' : 'item';
    let data: { englishName: string | null; icon: string | null; missing: boolean };
    try {
      const response = await this.fetcher(TOOLTIP_URL(path, kind, ref.id), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 404) {
        data = { englishName: null, icon: null, missing: true };
      } else if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      } else {
        const body = (await response.json()) as { name?: unknown; icon?: unknown; error?: unknown };
        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
        data = {
          englishName: name,
          icon: typeof body.icon === 'string' ? body.icon : null,
          missing: name === null,
        };
      }
    } catch (error) {
      this.logger.debug(`Wowhead ${kind} ${ref.id}: ${String(error)}`);
      data = { englishName: null, icon: null, missing: false };
    }
    const row = { ...data, fetchedAt: new Date() };
    await this.prisma.wowheadEntry.upsert({
      where: { kind_id: { kind: ref.kind, id: ref.id } },
      create: { kind: ref.kind, id: ref.id, ...row },
      update: row,
    });
  }
}
