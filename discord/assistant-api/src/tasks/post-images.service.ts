import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { BotFile } from '../discord/discord-bot.service';
import { sniffImageType } from '../guilds/banner';
import { MAX_IMAGE_BYTES, neutralFileName } from '../officer-requests/attachments';
import { identifyPostFile, POST_FILE_KINDS } from './post-files';
import type { PostConfig } from './post-task';

export interface PostImageDto {
  id: string;
  contentType: string;
  size: number;
  /** A file's name; null for an image. */
  fileName: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DTO_FIELDS = { id: true, contentType: true, size: true, fileName: true } as const;

/** Uploads nobody saved into a post are removed after this long. */
export const ORPHAN_IMAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The images and files of posts. One is uploaded first (from the post's form, before it is saved)
 * and later listed by id in a message of the post; saving the post makes it the post's. The bytes
 * stay in the database because the post is sent later, possibly days after it was written.
 */
@Injectable()
export class PostImagesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Stores an uploaded image or file for the guild, after checking what its bytes really are. */
  async upload(guildId: string, data: Buffer, originalName = ''): Promise<PostImageDto> {
    if (data.length === 0) throw new BadRequestException('No file was sent.');
    if (data.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException(`The file can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    }
    const imageType = sniffImageType(data);
    const type = imageType
      ? { contentType: imageType, fileName: null }
      : identifyPostFile(originalName, data);
    if (!type) {
      throw new BadRequestException(
        `The file must be an image (PNG, JPEG, GIF or WebP) or a ${POST_FILE_KINDS} file.`,
      );
    }
    return this.prisma.postImage.create({
      data: { guildId, ...type, size: data.length, data: new Uint8Array(data) },
      select: DTO_FIELDS,
    });
  }

  /** One image or file of the guild, for the form's preview or download. */
  async get(
    guildId: string,
    id: string,
  ): Promise<{ contentType: string; fileName: string | null; data: Buffer } | null> {
    if (!UUID.test(id)) return null;
    const image = await this.prisma.postImage.findFirst({ where: { id, guildId } });
    return image
      ? {
          contentType: image.contentType,
          fileName: image.fileName,
          data: Buffer.from(image.data),
        }
      : null;
  }

  /** Throws unless every listed image is one of this guild's that no other post uses. */
  async assertUsable(
    guildId: string,
    taskId: string | undefined,
    imageIds: readonly string[],
  ): Promise<void> {
    const ids = [...new Set(imageIds)];
    if (ids.length === 0) return;
    const found = await this.prisma.postImage.findMany({
      where: { id: { in: ids }, guildId },
      select: { id: true, taskId: true },
    });
    const usable = new Set(
      found.filter((image) => image.taskId === null || image.taskId === taskId).map((i) => i.id),
    );
    if (ids.some((id) => !usable.has(id))) {
      throw new BadRequestException(
        'One of the images or files is not available any more. Upload it again.',
      );
    }
  }

  /** After saving: the post owns the images it lists, and the ones it no longer lists are removed. */
  async attach(taskId: string, config: PostConfig): Promise<void> {
    const used = config.parts.flatMap((part) => part.imageIds);
    if (used.length > 0) {
      await this.prisma.postImage.updateMany({ where: { id: { in: used } }, data: { taskId } });
    }
    await this.prisma.postImage.deleteMany({ where: { taskId, id: { notIn: used } } });
  }

  /** The images and files of a message, in order, ready to send. */
  async files(imageIds: readonly string[]): Promise<BotFile[]> {
    if (imageIds.length === 0) return [];
    const images = await this.prisma.postImage.findMany({ where: { id: { in: [...imageIds] } } });
    const byId = new Map(images.map((image) => [image.id, image]));
    return imageIds.flatMap((id, index) => {
      const image = byId.get(id);
      if (!image) return [];
      const data = Buffer.from(image.data);
      if (image.fileName) {
        return [{ name: image.fileName, data, contentType: image.contentType }];
      }
      const extension = neutralFileName({ data, contentType: image.contentType }).split('.')[1];
      return [{ name: `image-${index + 1}.${extension}`, data, contentType: image.contentType }];
    });
  }

  /** What the form shows of the guild's images and files listed, in that order. */
  async describe(guildId: string, ids: readonly string[]): Promise<PostImageDto[]> {
    const imageIds = ids.filter((id) => UUID.test(id));
    if (imageIds.length === 0) return [];
    const images = await this.prisma.postImage.findMany({
      where: { id: { in: imageIds }, guildId },
      select: DTO_FIELDS,
    });
    const byId = new Map(images.map((image) => [image.id, image]));
    return imageIds.flatMap((id) => byId.get(id) ?? []);
  }

  /** Removes uploads that were never saved into a post. */
  async deleteOrphans(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.postImage.deleteMany({
      where: { taskId: null, createdAt: { lt: new Date(now.getTime() - ORPHAN_IMAGE_MAX_AGE_MS) } },
    });
    return count;
  }
}
