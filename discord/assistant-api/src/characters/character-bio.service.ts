import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { sniffImageType } from '../guilds/banner';
import { MAX_IMAGE_BYTES } from '../officer-requests/attachments';
import { resolveServer, supportsBios } from '../game/games';
import { formatCharacterName } from './character-name';
import { ROLE_LABELS } from './role-labels';

/** Generous, but bounded: a few thousand words of backstory, not an open-ended upload target. */
export const MAX_BIO_LENGTH = 20_000;
export const MAX_BIO_IMAGES = 4;

export interface BioPatch {
  bio?: string;
  bioVisible?: boolean;
}

export interface BioImage {
  id: string;
  contentType: string;
}

/**
 * A character's own page: who it is (guild-agnostic — the same page regardless of which guild it
 * is in, or none), and its bio as this viewer may see it.
 */
export interface CharacterProfile {
  characterId: string;
  name: string;
  class: string;
  race: string;
  level: number;
  roles: string[];
  isMain: boolean;
  /** Whether the viewer is the character's own player: only they may edit the bio. */
  isOwner: boolean;
  /** Whether this server offers bios at all (its rule set is 'RP'); hide the section if not. */
  bioSupported: boolean;
  bioVisible: boolean;
  /** The bio text, only when the viewer may see it (the owner, or `bioVisible` is set). */
  bio: string | null;
  /** Images, same visibility rule as the text; always empty (not null) when hidden. */
  images: BioImage[];
}

export type FindProfileResult = CharacterProfile | 'not-found';
export type UpdateBioResult = 'updated' | 'not-found' | 'forbidden' | 'not-supported';
export type AddImageResult = BioImage | 'not-found' | 'forbidden' | 'not-supported' | 'too-many';
export type RemoveImageResult = 'removed' | 'not-found' | 'forbidden';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A character's own page and its bio: free text (and a few images) its own player writes about
 * it, offered on a server whose rule set is 'RP' (src/game/<version>/config.ts). Unlike the rest
 * of the character, an Officer cannot write the bio for someone else — it is personal, roleplay
 * flavor text, not roster data. Both are guild-agnostic: reached by the character's server and
 * name, not by any one guild it happens to be in (every guild it is in shares that server).
 */
@Injectable()
export class CharacterBioService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Looks a character up by its server (from a URL, any case) and name (`Name-Lastname` split on
   * the first dash, only for versions that have last names, case-insensitive), and returns its
   * page: bio text and images only as this viewer may see them (always to its own player,
   * otherwise only when `bioVisible` is set).
   *
   * Character names are unique per player and server, not globally, so two different players
   * could in principle share a name; this returns whichever matches first.
   */
  async findProfile(
    urlVersion: string,
    urlRegion: string,
    urlRealm: string,
    namePath: string,
    viewerDiscordUserId: string | undefined,
  ): Promise<FindProfileResult> {
    const server = resolveServer(urlVersion, urlRegion, urlRealm);
    if (!server) return 'not-found';

    const [firstName, lastName] = splitNamePath(namePath);
    const character = await this.prisma.character.findFirst({
      where: {
        gameVersion: server.gameVersion,
        region: server.region,
        realm: server.realm,
        firstName: { equals: firstName, mode: 'insensitive' },
        lastName: { equals: lastName, mode: 'insensitive' },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        class: true,
        race: true,
        level: true,
        roles: true,
        isMain: true,
        bio: true,
        bioVisible: true,
        images: { select: { id: true, contentType: true }, orderBy: { createdAt: 'asc' } },
        player: { select: { discordUserId: true } },
      },
    });
    if (!character) return 'not-found';

    const isOwner = character.player.discordUserId === viewerDiscordUserId;
    const visible = isOwner || character.bioVisible;
    const bioOffered = supportsBios(server.gameVersion, server.region, server.realm);
    return {
      characterId: character.id,
      name: formatCharacterName(character),
      class: character.class,
      race: character.race,
      level: character.level,
      roles: character.roles.map((role) => ROLE_LABELS[role]),
      isMain: character.isMain,
      isOwner,
      bioSupported: bioOffered,
      bioVisible: bioOffered && character.bioVisible,
      bio: bioOffered && visible ? character.bio : null,
      images: bioOffered && visible ? character.images : [],
    };
  }

  /** Only the character's own player may write its bio; not even an Officer. */
  async updateBio(
    characterId: string,
    discordUserId: string,
    patch: BioPatch,
  ): Promise<UpdateBioResult> {
    const character = await this.ownedCharacter(characterId, discordUserId);
    if (character === 'not-found') return 'not-found';
    if (character === 'forbidden') return 'forbidden';
    if (!supportsBios(character.gameVersion, character.region, character.realm)) {
      return 'not-supported';
    }
    if (patch.bio !== undefined && patch.bio.length > MAX_BIO_LENGTH) {
      throw new BadRequestException(`A bio can have at most ${MAX_BIO_LENGTH} characters.`);
    }

    await this.prisma.character.update({ where: { id: characterId }, data: patch });
    return 'updated';
  }

  /** Stores an uploaded bio image, after checking its bytes really are an image. */
  async addImage(
    characterId: string,
    discordUserId: string,
    data: Buffer,
  ): Promise<AddImageResult> {
    const character = await this.ownedCharacter(characterId, discordUserId);
    if (character === 'not-found') return 'not-found';
    if (character === 'forbidden') return 'forbidden';
    if (!supportsBios(character.gameVersion, character.region, character.realm)) {
      return 'not-supported';
    }
    const count = await this.prisma.characterImage.count({ where: { characterId } });
    if (count >= MAX_BIO_IMAGES) return 'too-many';
    if (data.length === 0) throw new BadRequestException('No image was sent.');
    if (data.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException(
        `The image can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      );
    }
    const contentType = sniffImageType(data);
    if (!contentType) {
      throw new BadRequestException('The image must be a PNG, JPEG, GIF or WebP file.');
    }
    return this.prisma.characterImage.create({
      data: { characterId, contentType, size: data.length, data: new Uint8Array(data) },
      select: { id: true, contentType: true },
    });
  }

  /** Only the character's own player may remove one of its bio images. */
  async removeImage(
    characterId: string,
    imageId: string,
    discordUserId: string,
  ): Promise<RemoveImageResult> {
    const character = await this.ownedCharacter(characterId, discordUserId);
    if (character === 'forbidden') return 'forbidden';
    if (character === 'not-found') return 'not-found';
    const { count } = await this.prisma.characterImage.deleteMany({
      where: { id: imageId, characterId },
    });
    return count > 0 ? 'removed' : 'not-found';
  }

  /** One bio image's bytes, for serving; null if it does not exist (any character's). */
  async getImage(imageId: string): Promise<{ contentType: string; data: Buffer } | null> {
    if (!UUID.test(imageId)) return null;
    const image = await this.prisma.characterImage.findUnique({ where: { id: imageId } });
    return image ? { contentType: image.contentType, data: Buffer.from(image.data) } : null;
  }

  /** The character if `discordUserId` is its own player's; otherwise 'forbidden' or 'not-found'. */
  private async ownedCharacter(characterId: string, discordUserId: string) {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: {
        gameVersion: true,
        region: true,
        realm: true,
        player: { select: { discordUserId: true } },
      },
    });
    if (!character) return 'not-found' as const;
    if (character.player.discordUserId !== discordUserId) return 'forbidden' as const;
    return character;
  }
}

/** `Name-Lastname` on the first dash (a name part never has one itself); `Name` alone as `[Name, '']`. */
function splitNamePath(namePath: string): [string, string] {
  const [firstName, ...rest] = namePath.split('-');
  return [firstName, rest.join('-')];
}
