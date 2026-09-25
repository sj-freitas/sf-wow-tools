import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DiscordOAuthService } from '../auth/discord-oauth.service';
import type { PrismaService } from '../database/prisma.service';
import { PlayersService } from './players.service';

describe('PlayersService', () => {
  it('reads only the players of the requested guild', async () => {
    let where: unknown;
    const prisma = {
      player: {
        findMany: async (args: { where: unknown }) => {
          where = args.where;
          return [];
        },
      },
    } as unknown as PrismaService;
    await new PlayersService(prisma, {} as DiscordOAuthService).findForGuild('guild-a');
    assert.deepEqual(where, { guildId: 'guild-a' });
  });
});
