import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { CharacterBioController } from './character-bio.controller';
import type {
  CharacterBioService,
  FindProfileResult,
  UpdateBioResult,
} from './character-bio.service';

const ME = '111111111111111111';
const req = { user: { id: 'user-1', discordId: ME } } as AuthenticatedRequest;

describe('CharacterBioController', () => {
  let findResult: FindProfileResult;
  let updateResult: UpdateBioResult;
  let updates: { id: string; discordUserId: string; patch: unknown }[];
  let controller: CharacterBioController;

  beforeEach(() => {
    findResult = {
      characterId: 'c1',
      name: 'Merric Stone',
      class: 'Warrior',
      race: 'Human',
      level: 60,
      roles: ['Tank'],
      isMain: true,
      isOwner: true,
      bioSupported: true,
      bioVisible: false,
      bio: 'Text',
      images: [],
    };
    updateResult = 'updated';
    updates = [];
    const bioService = {
      findProfile: async () => findResult,
      updateBio: async (id: string, discordUserId: string, patch: unknown) => {
        updates.push({ id, discordUserId, patch });
        return updateResult;
      },
    } as unknown as CharacterBioService;
    controller = new CharacterBioController(bioService);
  });

  describe('find', () => {
    it('returns the character’s page for any logged-in user', async () => {
      assert.deepEqual(
        await controller.find(req, 'forever', 'eu', 'rp', 'Merric-Stone'),
        findResult,
      );
    });

    it('is a 404 when the service says "not-found"', async () => {
      findResult = 'not-found';
      await assert.rejects(
        controller.find(req, 'forever', 'eu', 'rp', 'Merric-Stone'),
        NotFoundException,
      );
    });
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
