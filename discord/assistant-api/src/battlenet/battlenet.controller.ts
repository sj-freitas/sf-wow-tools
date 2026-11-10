import { randomBytes } from 'node:crypto';
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { CacheService } from '../cache/cache.service';
import { formatCharacterName } from '../characters/character-name';
import { PrismaService } from '../database/prisma.service';
import {
  accountLabel,
  BattleNetService,
  serverLabel,
  type BattleNetCharacter,
  type BattleNetServer,
} from './battlenet.service';

/** A login started for a character, waiting for Battle.net to send the player back. */
const STATE_TTL_MS = 10 * 60 * 1000;
/** How long the result can be looked at. */
const RESULT_TTL_MS = 15 * 60 * 1000;

interface PendingCheck {
  userId: string;
  characterId: string;
}

/** What the check found, for the page that shows it. */
export interface BattleNetResultDto {
  /** The character it was for, and its page. */
  character: { name: string; pagePath: string };
  /** The character's server ("EU · Forever · RP"). */
  server: string;
  /** Where the account's characters were read: its version and region ("EU · Forever"). */
  account: string;
  battleTag: string | null;
  /** The account's characters there, on every server. */
  characters: BattleNetCharacter[];
  /** Whether the character is one of them (by Blizzard's id, else by name). */
  found: boolean;
  /** Its server's rule set in the armory ("Roleplay"); null when the armory doesn't have it. */
  armoryServer: string | null;
  /** Whether that is the rule set of the server it's on here (RP is "Roleplay"). */
  sameServer: boolean;
  /** Why it couldn't check (cancelled, Battle.net down, …); null when it did. */
  error: string | null;
}

/** The character's version, region and server (`realm` holds the server's name, `RP`). */
const serverOf = (character: {
  gameVersion: string;
  region: string;
  realm: string;
}): BattleNetServer => ({
  gameVersion: character.gameVersion,
  region: character.region,
  server: character.realm,
});

/** Name as compared: lower case, letters only ("Dark Shivan" = "darkshivan"). */
const nameKey = (name: string) => name.toLowerCase().replace(/[^\p{L}]/gu, '');

/**
 * "Verify with Battle.net" on a character's page: `login` sends the player to Battle.net,
 * `callback` reads their account's characters and keeps the result a while, `results/:id` shows
 * it (only to them). A preview: nothing about the character changes (see BattleNetService).
 */
@Controller('battlenet')
@UseGuards(AuthGuard)
export class BattleNetController {
  constructor(
    private readonly battleNet: BattleNetService,
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('login')
  async login(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query('characterId') characterId?: string,
  ): Promise<void> {
    const character = characterId ? await this.character(characterId) : null;
    if (!character) throw new NotFoundException('Character not found');
    if (!this.battleNet.configured) {
      return this.show(res, req.user.id, character, {
        error: 'Battle.net is not set up on this server.',
      });
    }
    const state = randomBytes(16).toString('base64url');
    await this.cache.set<PendingCheck>(
      `battlenet:state:${state}`,
      { userId: req.user.id, characterId: character.id },
      STATE_TTL_MS,
    );
    res.redirect(this.battleNet.authorizeUrl(state));
  }

  @Get('callback')
  async callback(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const pending = state
      ? await this.cache.get<PendingCheck>(`battlenet:state:${state}`)
      : undefined;
    if (state) await this.cache.delete(`battlenet:state:${state}`);
    // Only the person who started it, within its time.
    if (!pending || pending.userId !== req.user.id) {
      res.redirect('/');
      return;
    }
    const character = await this.character(pending.characterId);
    if (!character) {
      res.redirect('/');
      return;
    }
    if (error || !code) {
      return this.show(res, req.user.id, character, {
        error: 'Battle.net login was cancelled, so nothing was checked.',
      });
    }
    try {
      const where = serverOf(character);
      const ruleset = this.battleNet.ruleset(where);
      const token = await this.battleNet.exchange(code);
      // The account's characters say whether it's theirs; the armory, which server it is on.
      const [characters, battleTag, entry] = await Promise.all([
        this.battleNet.characters(token, where),
        this.battleNet.battleTag(token),
        this.battleNet.armoryEntry(where, character.firstName, character.lastName),
      ]);
      const key = nameKey(character.firstName);
      const fullKey = nameKey(`${character.firstName}${character.lastName}`);
      // Blizzard's id when both reads have it (two characters can share a first name); else names.
      const found =
        entry?.id != null && characters.some((c) => c.id !== null)
          ? characters.some((c) => c.id === entry.id)
          : characters.some((c) => [key, fullKey].includes(nameKey(c.name)));
      return this.show(res, req.user.id, character, {
        battleTag,
        characters,
        found,
        armoryServer: entry?.ruleset ?? null,
        sameServer: entry?.ruleset.toLowerCase() === ruleset.toLowerCase(),
      });
    } catch (caught) {
      return this.show(res, req.user.id, character, {
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }

  @Get('results/:id')
  async result(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<BattleNetResultDto> {
    const stored = await this.cache.get<BattleNetResultDto & { userId: string }>(
      `battlenet:result:${id}`,
    );
    if (!stored || stored.userId !== req.user.id) {
      throw new NotFoundException('That check has expired: verify again from the character page.');
    }
    const result: BattleNetResultDto & { userId?: string } = { ...stored };
    delete result.userId;
    return result;
  }

  private character(id: string) {
    return this.prisma.character
      .findUnique({
        where: { id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          gameVersion: true,
          region: true,
          realm: true,
        },
      })
      .catch(() => null);
  }

  /** Keeps the result for its page and sends the player there. */
  private async show(
    res: Response,
    userId: string,
    character: NonNullable<Awaited<ReturnType<BattleNetController['character']>>>,
    outcome: Partial<
      Pick<
        BattleNetResultDto,
        'battleTag' | 'characters' | 'found' | 'armoryServer' | 'sameServer' | 'error'
      >
    >,
  ): Promise<void> {
    const namePath = character.lastName
      ? `${character.firstName}-${character.lastName}`
      : character.firstName;
    const result: BattleNetResultDto = {
      character: {
        name: formatCharacterName(character),
        pagePath: `/${[character.gameVersion, character.region, character.realm]
          .map((part) => part.toLowerCase())
          .join('/')}/characters/${namePath}`,
      },
      server: serverLabel(serverOf(character)),
      account: accountLabel(serverOf(character)),
      battleTag: outcome.battleTag ?? null,
      characters: outcome.characters ?? [],
      found: outcome.found ?? false,
      armoryServer: outcome.armoryServer ?? null,
      sameServer: outcome.sameServer ?? false,
      error: outcome.error ?? null,
    };
    const id = randomBytes(12).toString('base64url');
    await this.cache.set(`battlenet:result:${id}`, { ...result, userId }, RESULT_TTL_MS);
    res.redirect(`/battlenet/${id}`);
  }
}
