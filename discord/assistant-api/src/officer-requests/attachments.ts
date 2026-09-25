import { sniffImageType } from '../guilds/banner';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** An image on its way into (or out of) a conversation. */
export interface MessageImage {
  data: Buffer;
  contentType: string;
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * The name the image gets in Discord, whatever it was called before: a member's file name can give
 * them away, so it is never kept.
 */
export const neutralFileName = (image: MessageImage): string =>
  `image.${EXTENSIONS[image.contentType] ?? 'png'}`;

export const IMAGE_MESSAGES = {
  notImage: 'The file must be a PNG, JPEG, GIF or WebP image.',
  tooBig: `The image is too big: the limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
  unreadable: 'I could not download that image from Discord. Please try again.',
} as const;

/** Checks the bytes really are an allowed image (the claimed type is never trusted). */
export function toMessageImage(data: Buffer): MessageImage | string {
  if (data.length > MAX_IMAGE_BYTES) return IMAGE_MESSAGES.tooBig;
  const contentType = sniffImageType(data);
  return contentType ? { data, contentType } : IMAGE_MESSAGES.notImage;
}
