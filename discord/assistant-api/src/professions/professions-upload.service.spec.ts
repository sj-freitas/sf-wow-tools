import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DiscordOAuthService } from '../auth/discord-oauth.service';
import type { PrismaService } from '../database/prisma.service';
import { ProfessionsUploadService } from './professions-upload.service';
import type { ProfessionsService } from './professions.service';

const USER = { id: 'u1', discordId: '150', displayName: 'Shivan' };
const EXPORT = JSON.stringify({ addon: 'GuildAssistantProfessions', format: 2, characters: [] });

/**
 * The player can see three guilds: Zeta (still on its server), Alpha (on the second of its two)
 * and Gone (left its server since their last login).
 */
function setup() {
  const prisma = {
    guildAccess: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        where.userId === 'u1'
          ? [
              { guild: { id: 'g-zeta', name: 'Zeta', servers: [{ discordId: 's-zeta' }] } },
              { guild: { id: 'g-gone', name: 'Gone', servers: [{ discordId: 's-gone' }] } },
              {
                guild: {
                  id: 'g-alpha',
                  name: 'Alpha',
                  servers: [{ discordId: 's-old' }, { discordId: 's-alpha' }],
                },
              },
            ]
          : [],
    },
  } as unknown as PrismaService;
  const discord = {
    fetchServerMember: async (serverId: string, userId: string) => {
      if (userId !== '150' || serverId === 's-gone' || serverId === 's-old') {
        throw new Error('Unknown Member');
      }
      return { user: { username: 'shivan' } };
    },
  } as unknown as DiscordOAuthService;
  const imports: { guildId: string; data: unknown }[] = [];
  const professions = {
    import: async (user: { id: string }, guildId: string, data: unknown) => {
      imports.push({ guildId, data });
      return { imported: [{ name: `In ${guildId}` }] };
    },
  } as unknown as ProfessionsService;
  return { uploads: new ProfessionsUploadService(prisma, discord, professions), imports };
}

describe('ProfessionsUploadService', () => {
  it('goes to the player’s guilds whose Discord servers they are still in, by name', async () => {
    const { uploads } = setup();
    assert.deepEqual(await uploads.whoAmI(USER), {
      user: { name: 'Shivan' },
      guilds: [
        { id: 'g-alpha', name: 'Alpha' },
        { id: 'g-zeta', name: 'Zeta' },
      ],
    });
  });

  it('imports the file into each of those guilds, as Import professions does', async () => {
    const { uploads, imports } = setup();
    const result = await uploads.upload(USER, EXPORT);
    assert.deepEqual(
      imports.map((i) => i.guildId),
      ['g-alpha', 'g-zeta'],
    );
    assert.ok(imports.every((i) => i.data === EXPORT));
    assert.deepEqual(
      result.guilds.map((g) => [g.name, g.result.imported[0].name]),
      [
        ['Alpha', 'In g-alpha'],
        ['Zeta', 'In g-zeta'],
      ],
    );
  });

  it('says what’s wrong with a file that has no export, before importing anything', async () => {
    const { uploads, imports } = setup();
    await assert.rejects(uploads.upload(USER, 'GuildAssistantProfessionsDB = {}'), /export/);
    assert.deepEqual(imports, []);
  });
});
