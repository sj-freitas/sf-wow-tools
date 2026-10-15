import { deflateSync } from 'node:zlib';

/**
 * A round dot of one colour as a PNG (transparent around it), for the class-colour emojis. Drawn
 * here so that the colours in the game config are all it takes: no image files to keep in sync.
 * The rim is a darker shade so light colours (the Priest's white) still show on a light theme.
 */
export function colorDotPng(hex: string, size = 64): Buffer {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const center = (size - 1) / 2;
  const radius = size * 0.44;
  const rim = size * 0.06;
  const row = size * 4 + 1;
  const pixels = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    pixels[y * row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - center, y - center);
      // Anti-aliased edge: fully opaque inside, fading over one pixel.
      const alpha = Math.min(1, Math.max(0, radius + 0.5 - distance));
      const shade = distance > radius - rim ? 0.6 : 1;
      const at = y * row + 1 + x * 4;
      pixels[at] = Math.round(r * shade);
      pixels[at + 1] = Math.round(g * shade);
      pixels[at + 2] = Math.round(b * shade);
      pixels[at + 3] = Math.round(alpha * 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
