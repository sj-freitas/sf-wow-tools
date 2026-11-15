// Draws the app's icons (`npm run icons`): a monitor with a laptop in front of it. The app icon
// (assets/icon.png, white on the website's purple) and the menu bar's (trayTemplate*.png, black:
// macOS colours a template icon for the menu bar itself).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/** Whether (x, y) is inside a rectangle with rounded corners (all in the icon's 0–1 units). */
const roundRect = (x0, y0, x1, y1, r) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const outline = (x0, y0, x1, y1, r, width) => {
  const outer = roundRect(x0, y0, x1, y1, r);
  const inner = roundRect(x0 + width, y0 + width, x1 - width, y1 - width, Math.max(0, r - width));
  return (x, y) => outer(x, y) && !inner(x, y);
};

/** The picture: what's drawn, in order ('clear' leaves the background showing). */
function glyph(stroke) {
  return [
    // The monitor, its neck and foot.
    ['ink', outline(0.14, 0.2, 0.74, 0.62, 0.04, stroke)],
    ['ink', roundRect(0.4, 0.62, 0.48, 0.72, 0)],
    ['ink', roundRect(0.31, 0.7, 0.57, 0.75, 0.02)],
    // The laptop in front: the monitor cleared behind it, then its screen and base.
    ['clear', roundRect(0.5, 0.44, 0.92, 0.84, 0.03)],
    ['ink', outline(0.56, 0.5, 0.86, 0.73, 0.025, stroke * 0.85)],
    ['ink', roundRect(0.52, 0.74, 0.9, 0.79, 0.02)],
  ];
}

/** Renders `size`×`size` RGBA pixels: `paint(x, y)` gives a background colour (or null). */
function render(size, layers, ink, paint) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          let color = paint(x, y);
          for (const [kind, inside] of layers) {
            if (inside(x, y)) color = kind === 'ink' ? ink : paint(x, y);
          }
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += color[3];
          }
        }
      }
      const n = samples * samples;
      const i = (py * size + px) * 4;
      // Colours averaged by how much they cover (premultiplied), then back.
      pixels[i + 3] = Math.round(a / n);
      const alpha = a / 255 || 1;
      pixels[i] = Math.round(r / alpha);
      pixels[i + 1] = Math.round(g / alpha);
      pixels[i + 2] = Math.round(b / alpha);
    }
  }
  return pixels;
}

/** Each colour weighted by its alpha, so render can average them. */
const weighted = ([r, g, b, a]) => [(r * a) / 255, (g * a) / 255, (b * a) / 255, a];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, sum]);
}
function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// The app icon: macOS's rounded square (824 of 1024), the website's purple, top to bottom.
const body = roundRect(100 / 1024, 100 / 1024, 924 / 1024, 924 / 1024, 185 / 1024);
const top = [0x9b, 0x74, 0xe3];
const bottom = [0x56, 0x33, 0x9e];
const purple = (x, y) => {
  if (!body(x, y)) return null;
  const t = Math.min(Math.max((y - 0.1) / 0.8, 0), 1);
  return weighted([...top.map((c, i) => c + (bottom[i] - c) * t), 255]);
};
// The glyph inside the square: its 0–1 units scaled to the square's middle.
const inSquare = (layers) =>
  layers.map(([kind, inside]) => [kind, (x, y) => inside((x - 0.14) / 0.72, (y - 0.13) / 0.72)]);
writeFileSync(
  join(assets, 'icon.png'),
  png(1024, render(1024, inSquare(glyph(0.06)), weighted([255, 255, 255, 255]), purple)),
);

// The menu bar's: 18 points, and 36 pixels for Retina screens.
for (const [file, size] of [
  ['trayTemplate.png', 18],
  ['trayTemplate@2x.png', 36],
]) {
  writeFileSync(
    join(assets, file),
    png(
      size,
      render(size, glyph(0.09), weighted([0, 0, 0, 255]), () => null),
    ),
  );
}
