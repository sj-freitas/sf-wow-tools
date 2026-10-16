import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { GuildAccessService } from '../auth/guild-access.service';
import { CharacterNotesController } from './character-notes.controller';
import type { CharacterNotesService } from './character-notes.service';

const GUILD = '0b6f3c2e-5d4a-4f1b-9c8d-7e6f5a4b3c2d';
const CHARACTER = 'f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';
const req = (id: string) =>
  ({ user: { id, discordId: `d-${id}`, displayName: `Name ${id}` } }) as AuthenticatedRequest;

describe('CharacterNotesController', () => {
  let saved: { markdown: string; by: string } | null;
  let controller: CharacterNotesController;

  beforeEach(() => {
    saved = null;
    const notes = {
      withNotes: () => Promise.resolve([CHARACTER]),
      get: () =>
        Promise.resolve({
          characterId: CHARACTER,
          characterName: 'Dark Shivan',
          characterClass: 'Priest',
          markdown: 'Great healer.',
          updatedAt: null,
          updatedByName: null,
          images: [],
        }),
      save: (_g: string, _c: string, markdown: string, by: string) => {
        saved = { markdown, by };
        return Promise.resolve();
      },
    } as unknown as CharacterNotesService;
    const guildAccess = {
      // Only user "officer" is an Officer of the guild.
      assertOfficer: (userId: string) =>
        userId === 'officer'
          ? Promise.resolve()
          : Promise.reject(new ForbiddenException("Requires the guild's Officer role")),
    } as unknown as GuildAccessService;
    controller = new CharacterNotesController(notes, guildAccess);
  });

  it('lets Officers read and write notes, signed with their name', async () => {
    assert.deepEqual(await controller.withNotes(req('officer'), GUILD), {
      characterIds: [CHARACTER],
    });
    assert.equal(
      (await controller.get(req('officer'), GUILD, CHARACTER)).markdown,
      'Great healer.',
    );
    await controller.save(req('officer'), GUILD, CHARACTER, { markdown: 'Better tank.' });
    assert.deepEqual(saved, { markdown: 'Better tank.', by: 'Name officer' });
  });

  it('refuses everyone else, the character’s own player included', async () => {
    const player = req('player');
    await assert.rejects(controller.withNotes(player, GUILD), ForbiddenException);
    await assert.rejects(controller.get(player, GUILD, CHARACTER), ForbiddenException);
    await assert.rejects(
      controller.save(player, GUILD, CHARACTER, { markdown: 'x' }),
      ForbiddenException,
    );
    await assert.rejects(
      controller.addImage(player, GUILD, CHARACTER, { buffer: Buffer.from('x') }),
      ForbiddenException,
    );
    await assert.rejects(
      controller.removeImage(player, GUILD, CHARACTER, CHARACTER),
      ForbiddenException,
    );
    assert.equal(saved, null);
  });
});
