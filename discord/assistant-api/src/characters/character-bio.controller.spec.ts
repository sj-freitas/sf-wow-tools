import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { GuildAccessService } from '../auth/guild-access.service';
import { CharacterBioController } from './character-bio.controller';
import type { CharacterBioService, FindBioResult, UpdateBioResult } from './character-bio.service';

const ME = '111111111111111111';
const req = { user: { id: 'user-1', discordId: ME } } as AuthenticatedRequest;

describe('CharacterBioController', () => {
  let isMember: boolean;
  let findResult: FindBioResult;
  let updateResult: UpdateBioResult;
  let updates: { id: string; discordUserId: string; patch: unknown }[];
  let controller: CharacterBioController;

  beforeEach(() => {
    isMember = true;
    findResult = {
      characterId: 'c1',
      name: 'Merric Stone',
      isOwner: true,
      bioVisible: false,
      bio: 'Text',
      images: [],
    };
    updateResult = 'updated';
    updates = [];
    const bioService = {
      findBio: async () => findResult,
      updateBio: async (id: string, discordUserId: string, patch: unknown) => {
        updates.push({ id, discordUserId, patch });
        return updateResult;
      },
    } as unknown as CharacterBioService;
    const guildAccess = {
      find: async () => (isMember ? { isAdmin: false, isOfficer: false } : null),
    } as unknown as GuildAccessService;
    controller = new CharacterBioController(bioService, guildAccess);
  });

  describe('find', () => {
    it('returns the bio for a member of the guild', async () => {
      assert.deepEqual(await controller.find(req, 'g', 'Merric-Stone'), findResult);
    });

    it('forbids a non-member', async () => {
      isMember = false;
      await assert.rejects(controller.find(req, 'g', 'Merric-Stone'), ForbiddenException);
    });

    for (const outcome of ['no-guild', 'not-supported', 'not-found'] as const) {
      it(`is a 404 when the service says "${outcome}"`, async () => {
        findResult = outcome;
        await assert.rejects(controller.find(req, 'g', 'Merric-Stone'), NotFoundException);
      });
    }
  });

  describe('update', () => {
    it('passes the viewer’s Discord id and the patch through', async () => {
      await controller.update(req, 'c1', { bio: 'New text', bioVisible: true });
      assert.deepEqual(updates, [
        { id: 'c1', discordUserId: ME, patch: { bio: 'New text', bioVisible: true } },
      ]);
    });

    it('rejects a non-string bio and a non-boolean bioVisible', async () => {
      await assert.rejects(controller.update(req, 'c1', { bio: 5 }), BadRequestException);
      await assert.rejects(
        controller.update(req, 'c1', { bioVisible: 'yes' }),
        BadRequestException,
      );
      assert.equal(updates.length, 0);
    });

    it('translates the service result into the matching HTTP error', async () => {
      updateResult = 'not-found';
      await assert.rejects(controller.update(req, 'c1', {}), NotFoundException);
      updateResult = 'forbidden';
      await assert.rejects(controller.update(req, 'c1', {}), ForbiddenException);
      updateResult = 'not-supported';
      await assert.rejects(controller.update(req, 'c1', {}), BadRequestException);
    });
  });
});
