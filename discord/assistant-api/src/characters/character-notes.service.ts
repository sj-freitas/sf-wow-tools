import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { sniffImageType } from '../guilds/banner';
import { MAX_IMAGE_BYTES } from '../officer-requests/attachments';
import { formatCharacterName } from './character-name';

export const MAX_NOTE_LENGTH = 20_000;
export const MAX_NOTE_IMAGES = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OfficerNoteDto {
  characterId: string;
  characterName: string;
  characterClass: string;
  /** Markdown; empty when nobody wrote one yet. */
  markdown: string;
  updatedAt: string | null;
  updatedByName: string | null;
  images: { id: string; contentType: string }[];
}

/**
 * Officers' private notes about the guild's characters: markdown and images, one note per guild
 * and character. Every method is for a guild's Officers only — the callers check that; the player
 * never sees these. Notes are keyed by guild and character, so a character that leaves the roster
 * and comes back keeps its note.
 */
@Injectable()
export class CharacterNotesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The characters of the guild that have a note (non-empty or with images), for the roster. */
  async withNotes(guildId: string): Promise<string[]> {
    const notes = await this.prisma.characterOfficerNote.findMany({
      where: { guildId, OR: [{ markdown: { not: '' } }, { images: { some: {} } }] },
      select: { characterId: true },
    });
    return notes.map((note) => note.characterId);
  }

  /** The note about a character on the guild's roster (an empty one if none was written). */
  async get(guildId: string, characterId: string): Promise<OfficerNoteDto> {
    const character = await this.rosterCharacter(guildId, characterId);
    const note = await this.prisma.characterOfficerNote.findUnique({
      where: { guildId_characterId: { guildId, characterId } },
      include: {
        images: { select: { id: true, contentType: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    return {
      characterId,
      characterName: formatCharacterName(character),
      characterClass: character.class,
      markdown: note?.markdown ?? '',
      updatedAt: note?.updatedAt.toISOString() ?? null,
      updatedByName: note?.updatedByName ?? null,
      images: note?.images ?? [],
    };
  }

  async save(guildId: string, characterId: string, markdown: string, by: string): Promise<void> {
    await this.rosterCharacter(guildId, characterId);
    if (markdown.length > MAX_NOTE_LENGTH) {
      throw new BadRequestException(`A note can have at most ${MAX_NOTE_LENGTH} characters.`);
    }
    await this.prisma.characterOfficerNote.upsert({
      where: { guildId_characterId: { guildId, characterId } },
      create: { guildId, characterId, markdown, updatedByName: by },
      update: { markdown, updatedByName: by },
    });
  }

  /** Stores an image for the note, after checking its bytes really are an image. */
  async addImage(
    guildId: string,
    characterId: string,
    data: Buffer,
    by: string,
  ): Promise<{ id: string; contentType: string }> {
    await this.rosterCharacter(guildId, characterId);
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
    const note = await this.prisma.characterOfficerNote.upsert({
      where: { guildId_characterId: { guildId, characterId } },
      create: { guildId, characterId, updatedByName: by },
      update: {},
      select: { id: true, _count: { select: { images: true } } },
    });
    if (note._count.images >= MAX_NOTE_IMAGES) {
      throw new BadRequestException(`A note can have at most ${MAX_NOTE_IMAGES} images.`);
    }
    return this.prisma.characterOfficerNoteImage.create({
      data: { noteId: note.id, contentType, size: data.length, data: new Uint8Array(data) },
      select: { id: true, contentType: true },
    });
  }

  async removeImage(guildId: string, characterId: string, imageId: string): Promise<void> {
    if (!UUID.test(imageId)) throw new NotFoundException('No such image');
    const { count } = await this.prisma.characterOfficerNoteImage.deleteMany({
      where: { id: imageId, note: { guildId, characterId } },
    });
    if (count === 0) throw new NotFoundException('No such image');
  }

  /** One image of one of the guild's notes; null if it isn't one. */
  async getImage(
    guildId: string,
    imageId: string,
  ): Promise<{ contentType: string; data: Buffer } | null> {
    if (!UUID.test(imageId)) return null;
    const image = await this.prisma.characterOfficerNoteImage.findFirst({
      where: { id: imageId, note: { guildId } },
    });
    return image ? { contentType: image.contentType, data: Buffer.from(image.data) } : null;
  }

  /** The character, if it is on the guild's roster; 404 otherwise. */
  private async rosterCharacter(guildId: string, characterId: string) {
    const character = UUID.test(characterId)
      ? await this.prisma.character.findFirst({
          where: { id: characterId, guilds: { some: { guildId } } },
          select: { firstName: true, lastName: true, class: true },
        })
      : null;
    if (!character) throw new NotFoundException('That character is not on the roster.');
    return character;
  }
}
