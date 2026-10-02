import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { sniffImageType } from '../guilds/banner';
import { MAX_IMAGE_BYTES } from '../officer-requests/attachments';
import { supportsBios } from '../game/games';
import { formatCharacterName } from './character-name';

export const MAX_BIO_LENGTH = 4000;
export const MAX_BIO_IMAGES = 4;

export interface BioPatch {
  bio?: string;
  bioVisible?: boolean;
}

export interface BioImage {
  id: string;
  contentType: string;
}

export interface BioView {
  characterId: string;
  name: string;
  /** Whether the viewer is the character's own player: only they may edit it. */
  isOwner: boolean;
  bioVisible: boolean;
  /** The text, only when the viewer may see it (the owner, or `bioVisible` is set). */
  bio: string | null;
  /** Images, same visibility rule as the text; always empty (not null) when hidden. */
  images: BioImage[];
}

export type FindBioResult = BioView | 'no-guild' | 'not-supported' | 'not-found';
export type UpdateBioResult = 'updated' | 'not-found' | 'forbidden' | 'not-supported';
export type AddImageResult = BioImage | 'not-found' | 'forbidden' | 'not-supported' | 'too-many';
export type RemoveImageResult = 'removed' | 'not-found' | 'forbidden';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A character's bio: free text (and a few images) its own player writes about it, on guilds whose
 * server has the 'RP' rule set (src/game/<version>/config.ts). Unlike the rest of the character, an
 * Officer cannot write it for someone else — it is personal, roleplay flavor text, not roster data.
 * Guild-agnostic like the character itself: whether it is offered at all is checked against the
 * character's own server, not any one guild it happens to be in (every guild a character is in
 * shares its server, so these always agree).
 */
@Injectable()
export class CharacterBioService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Looks a character up by name within a guild (`Name-Lastname` split on the first dash, only
   * for versions that have last names), and returns its bio as this viewer may see it: always to
   * its own player, otherwise only when `bioVisible` is set.
   *
   * Character names are unique per player and server, not per guild, so two different players
   * could in principle share a name; this returns whichever matches first.
   */
  async findBio(
    guildId: string,
    namePath: string,
    viewerDiscordUserId: string | undefined,
  ): Promise<FindBioResult> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { gameVersion: true, region: true, realm: true },
    });
    if (!guild) return 'no-guild';
    if (!supportsBios(guild.gameVersion, guild.region, guild.realm)) return 'not-supported';

    const [firstName, lastName] = splitNamePath(namePath);
    const character = await this.prisma.character.findFirst({
      where: {
        firstName: { equals: firstName, mode: 'insensitive' },
        lastName: { equals: lastName, mode: 'insensitive' },
        guilds: { some: { guildId } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        bio: true,
        bioVisible: true,
        images: { select: { id: true, contentType: true }, orderBy: { createdAt: 'asc' } },
        player: { select: { discordUserId: true } },
      },
    });
    if (!character) return 'not-found';

    const isOwner = character.player.discordUserId === viewerDiscordUserId;
    const visible = isOwner || character.bioVisible;
    return {
      characterId: character.id,
      name: formatCharacterName(character),
      isOwner,
      bioVisible: character.bioVisible,
      bio: visible ? character.bio : null,
      images: visible ? character.images : [],
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
