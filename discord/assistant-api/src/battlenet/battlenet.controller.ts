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
import { BattleNetService, type BattleNetCharacter } from './battlenet.service';

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
  /** The server it read ("EU · Classic Season of Discovery · Wild Growth"). */
  server: string;
  battleTag: string | null;
  /** The account's characters on that server. */
  characters: BattleNetCharacter[];
  /** Whether the character is one of them. */
  found: boolean;
  /** Why it couldn't check (cancelled, Battle.net down, …); null when it did. */
  error: string | null;
}

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
      const token = await this.battleNet.exchange(code);
      const [characters, battleTag] = await Promise.all([
        this.battleNet.characters(token),
        this.battleNet.battleTag(token),
      ]);
      const key = nameKey(character.firstName);
      const fullKey = nameKey(`${character.firstName}${character.lastName}`);
      return this.show(res, req.user.id, character, {
        battleTag,
        characters,
        found: characters.some((c) => [key, fullKey].includes(nameKey(c.name))),
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
    outcome: Partial<Pick<BattleNetResultDto, 'battleTag' | 'characters' | 'found' | 'error'>>,
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
      server: this.battleNet.server,
      battleTag: outcome.battleTag ?? null,
      characters: outcome.characters ?? [],
      found: outcome.found ?? false,
      error: outcome.error ?? null,
    };
    const id = randomBytes(12).toString('base64url');
    await this.cache.set(`battlenet:result:${id}`, { ...result, userId }, RESULT_TTL_MS);
    res.redirect(`/battlenet/${id}`);
  }
}
