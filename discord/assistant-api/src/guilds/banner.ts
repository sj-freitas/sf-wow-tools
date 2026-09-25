import { PayloadTooLargeException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

export const MAX_BANNER_BYTES = 2 * 1024 * 1024;

/**
 * The image type by its first bytes, or null when it is not a PNG, JPEG, GIF or WebP. The type the
 * uploader claims is never trusted, and SVG is left out on purpose: it can carry scripts.
 */
export function sniffImageType(data: Buffer): string | null {
  const starts = (bytes: number[], offset = 0) =>
    data.length >= offset + bytes.length && bytes.every((byte, i) => data[offset + i] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** Reads a request body as bytes, giving up as soon as it passes `maxBytes`. */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(
          new PayloadTooLargeException(`The banner can be at most ${maxBytes / 1024 / 1024} MB.`),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
