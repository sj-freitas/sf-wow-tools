import { Injectable, Logger, OnApplicationShutdown, Optional } from '@nestjs/common';
import type { Faction, Role } from '@prisma/client';
import { ROLE_LABELS } from '../characters/role-labels';
import { PrismaService } from '../database/prisma.service';
import { armoryNamespaceFor, classesOf, classesOfRace, racesOf, rolesOfClass } from '../game/games';
import { RealtimeService } from '../realtime/realtime.service';
import { ArmoryError, ArmoryService, type ArmoryCharacter } from './armory.service';

const PASS_MS = 10 * 60 * 1000;
/** Characters looked up per pass: one request each, well inside Blizzard's limits. */
const BATCH = 50;
/** A character is looked up again this long after the last time. */
export const RECHECK_MS = 6 * 60 * 60 * 1000;
const MAX_LEVEL = 100;

/** What the sync needs of a character. */
export interface SyncedCharacter {
  gameVersion: string;
  faction: Faction;
  race: string;
  class: string;
  level: number;
  roles: Role[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * What to change on a character so it matches the armory: its race, class and level, each only
 * when the armory's fits the game config (the race in the character's faction, the class one that
 * race can be). A character of the other faction is someone else with the same name: nothing
 * changes. When the class changes, the roles the new class can't play go (its first is kept
 * when none is left).
 */
export function armoryPatch(
  character: SyncedCharacter,
  found: Pick<ArmoryCharacter, 'race' | 'class' | 'level' | 'faction'>,
): Partial<Pick<SyncedCharacter, 'race' | 'class' | 'level' | 'roles'>> {
  if (found.faction && !same(found.faction, character.faction)) return {};
  const patch: Partial<Pick<SyncedCharacter, 'race' | 'class' | 'level' | 'roles'>> = {};

  const race =
    racesOf(character.gameVersion, character.faction).find((r) => same(r.race, found.race))?.race ??
    character.race;
  const characterClass =
    classesOf(character.gameVersion).find((c) => same(c, found.class)) ?? character.class;
  const allowed = classesOfRace(character.gameVersion, character.faction, race);
  if (allowed === null || allowed.includes(characterClass)) {
    if (race !== character.race) patch.race = race;
    if (characterClass !== character.class) {
      patch.class = characterClass;
      const labels = rolesOfClass(character.gameVersion, characterClass);
      const playable = (Object.keys(ROLE_LABELS) as Role[]).filter((role) =>
        labels.includes(ROLE_LABELS[role]),
      );
      if (playable.length > 0) {
        const kept = character.roles.filter((role) => playable.includes(role));
        patch.roles = kept.length > 0 ? kept : [playable[0]];
      }
    }
  }
  if (Number.isInteger(found.level) && found.level >= 1 && found.level <= MAX_LEVEL) {
    if (found.level !== character.level) patch.level = found.level;
  }
  return patch;
}

/**
 * In the background (the worker), keeps characters in step with their version's armory: every 10
 * minutes it looks up the characters checked longest ago (never, or over 6 hours ago) and updates
 * race, class and level when the armory says otherwise (`armoryPatch`). A character the armory
 * doesn't have is left as it is, checked again later; when Blizzard is down the pass stops and the
 * next one carries on. Nothing runs without the Battle.net client (BLIZZARD_CLIENT_ID/SECRET).
 */
@Injectable()
export class ArmorySyncService implements OnApplicationShutdown {
  private readonly logger = new Logger(ArmorySyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly armory: ArmoryService,
    // Live updates of open rosters; not there when the worker runs in its own process.
    @Optional() private readonly realtime?: RealtimeService,
  ) {}

  start(): void {
    if (this.timer || !this.armory.configured) return;
    void this.run();
    this.timer = setInterval(() => void this.run(), PASS_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Returns how many were looked up and how many changed. Never throws. */
  async run(now: Date = new Date()): Promise<{ checked: number; updated: number }> {
    const result = { checked: 0, updated: 0 };
    if (this.running) return result;
    this.running = true;
    try {
      const characters = await this.prisma.character.findMany({
        where: {
          OR: [
            { armoryCheckedAt: null },
            { armoryCheckedAt: { lt: new Date(now.getTime() - RECHECK_MS) } },
          ],
        },
        orderBy: { armoryCheckedAt: { sort: 'asc', nulls: 'first' } },
        take: BATCH,
        select: {
          id: true,
          gameVersion: true,
          region: true,
          faction: true,
          firstName: true,
          lastName: true,
          race: true,
          class: true,
          level: true,
          roles: true,
          guilds: { select: { guildId: true } },
        },
      });
      for (const character of characters) {
        const namespace = armoryNamespaceFor(character.gameVersion, character.region);
        let patch = {};
        if (namespace) {
          try {
            const found = await this.armory.lookup(
              {
                namespace,
                region: character.region,
                name: character.firstName,
                lastName: character.lastName,
              },
              { talents: false },
            );
            patch = armoryPatch(character, found);
          } catch (error) {
            // Not there (yet): checked, left as it is. Anything else: Blizzard is down, try later.
            if (!(error instanceof ArmoryError) || error.failure !== 'not-found') break;
          }
        }
        await this.prisma.character.update({
          where: { id: character.id },
          data: { ...patch, armoryCheckedAt: now },
        });
        result.checked++;
        if (Object.keys(patch).length > 0) {
          result.updated++;
          for (const { guildId } of character.guilds) this.realtime?.publish(guildId, 'characters');
        }
      }
      if (result.updated > 0) {
        this.logger.log(
          `Armory: ${result.updated} of ${result.checked} characters updated (race, class, level)`,
        );
      }
    } catch (error) {
      this.logger.error(`Syncing characters with the armory failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
    return result;
  }
}
