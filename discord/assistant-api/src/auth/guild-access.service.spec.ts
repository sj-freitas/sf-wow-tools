import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service';
import { GuildAccessService } from './guild-access.service';

function serviceWith(access: { isAdmin: boolean; isOfficer: boolean } | null) {
  const prisma = { guildAccess: { findUnique: async () => access } } as unknown as PrismaService;
  return new GuildAccessService(prisma);
}

describe('GuildAccessService', () => {
  it('assertCanConfigure lets Guild-Assistants and Officers through', async () => {
    await serviceWith({ isAdmin: true, isOfficer: false }).assertCanConfigure('u', 'g');
    await serviceWith({ isAdmin: false, isOfficer: true }).assertCanConfigure('u', 'g');
  });

  it('assertCanConfigure rejects plain members and outsiders', async () => {
    await assert.rejects(
      serviceWith({ isAdmin: false, isOfficer: false }).assertCanConfigure('u', 'g'),
      ForbiddenException,
    );
    await assert.rejects(serviceWith(null).assertCanConfigure('u', 'g'), ForbiddenException);
  });

  it('assertOfficer only lets Officers through, not Guild-Assistants', async () => {
    await serviceWith({ isAdmin: false, isOfficer: true }).assertOfficer('u', 'g');
    await assert.rejects(
      serviceWith({ isAdmin: true, isOfficer: false }).assertOfficer('u', 'g'),
      ForbiddenException,
    );
    await assert.rejects(serviceWith(null).assertOfficer('u', 'g'), ForbiddenException);
  });
});
