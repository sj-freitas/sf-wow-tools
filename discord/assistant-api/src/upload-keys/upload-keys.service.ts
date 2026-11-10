import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '../auth/auth.types';
import { PrismaService } from '../database/prisma.service';

/** What every key starts with ("gak_": Guild Assistant key), to tell one at a glance. */
export const KEY_PREFIX = 'gak_';
/** How much of a key the page shows next to its name ("gak_Ab12Cd"). */
const SHOWN = KEY_PREFIX.length + 6;
/** A player's keys at most: one per computer is plenty. */
export const MAX_KEYS = 10;
export const MAX_NAME = 40;

const hashKey = (key: string): string => createHash('sha256').update(key).digest('hex');

/** One of the player's keys on the Upload keys page (never the key itself, which isn't kept). */
export interface UploadKeyDto {
  id: string;
  name: string;
  /** Its first characters ("gak_Ab12Cd"). */
  prefix: string;
  createdAt: string;
  /** When the uploader last used it; null: never. */
  lastUsedAt: string | null;
}

const toDto = (key: {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}): UploadKeyDto => ({
  id: key.id,
  name: key.name,
  prefix: key.prefix,
  createdAt: key.createdAt.toISOString(),
  lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
});

/**
 * Upload keys (prisma/upload-keys.prisma): a player makes one for the Guild Assistant Uploader on
 * their computer, which sends it instead of a login to upload their professions file. The key is
 * shown once, when it's made; only its SHA-256 is kept.
 */
@Injectable()
export class UploadKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<UploadKeyDto[]> {
    const keys = await this.prisma.uploadKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map(toDto);
  }

  /** A new key called `name`: the key itself (`key`) is in this answer only. */
  async create(userId: string, name: unknown): Promise<UploadKeyDto & { key: string }> {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) throw new BadRequestException('Give the key a name, like "My computer".');
    if (trimmed.length > MAX_NAME) {
      throw new BadRequestException(`A key's name is ${MAX_NAME} characters at most.`);
    }
    const count = await this.prisma.uploadKey.count({ where: { userId } });
    if (count >= MAX_KEYS) {
      throw new BadRequestException(
        `You have ${MAX_KEYS} keys already: delete one you don't use first.`,
      );
    }
    const key = KEY_PREFIX + randomBytes(24).toString('base64url');
    const created = await this.prisma.uploadKey.create({
      data: { userId, name: trimmed, keyHash: hashKey(key), prefix: key.slice(0, SHOWN) },
    });
    return { ...toDto(created), key };
  }

  async delete(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.uploadKey.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('That key is already gone.');
  }

  /** Whose key it is (and notes it was used now); null when it isn't one, or was deleted. */
  async userOf(key: string): Promise<SessionUser | null> {
    if (!key.startsWith(KEY_PREFIX)) return null;
    const found = await this.prisma.uploadKey.findUnique({
      where: { keyHash: hashKey(key) },
      include: { user: true },
    });
    if (!found) return null;
    await this.prisma.uploadKey.update({
      where: { id: found.id },
      data: { lastUsedAt: new Date() },
      select: { id: true },
    });
    const { id, discordId, username, displayName, avatar } = found.user;
    return { id, discordId, username, displayName: displayName ?? username, avatar };
  }
}
