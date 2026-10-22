#!/usr/bin/env node
/* Generates the PWA icon set with no dependencies.
 *
 * Draws a cream shopping bag on a green gradient, supersampled 4x for smooth
 * edges, and encodes the PNGs by hand (zlib + CRC32).
 *
 * Usage: node scripts/make-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'icons');
const SAMPLES = 4; // 4x4 samples per pixel

const BAG = [247, 242, 229];
const BG_TOP = [36, 122, 75];
const BG_BOTTOM = [26, 92, 56];

/* ---------- PNG encoding ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- Drawing ---------- */

function insideRoundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideBag(x, y) {
  // Handle: upper half of a ring, sits on the bag's top edge.
  const dx = x - 0.5;
  const dy = y - 0.43;
  const radius = Math.sqrt(dx * dx + dy * dy);
  const inHandle = dy <= 0.001 && radius <= 0.105 && radius >= 0.072;

  const inBody = insideRoundedRect(x, y, 0.27, 0.41, 0.73, 0.79, 0.055);

  return inHandle || inBody;
}

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bagHits = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = (x + (sx + 0.5) / SAMPLES) / size;
          const py = (y + (sy + 0.5) / SAMPLES) / size;
          if (insideBag(px, py)) bagHits += 1;
        }
      }

      const coverage = bagHits / (SAMPLES * SAMPLES);
      const t = y / (size - 1);
      const index = (y * size + x) * 4;

      for (let channel = 0; channel < 3; channel += 1) {
        const bg = BG_TOP[channel] + (BG_BOTTOM[channel] - BG_TOP[channel]) * t;
        pixels[index + channel] = Math.round(bg * (1 - coverage) + BAG[channel] * coverage);
      }
      pixels[index + 3] = 255;
    }
  }

  return { pixels, width: size, height: size };
}

/* ---------- Output ---------- */

const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
];

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const [name, size] of targets) {
  const { pixels, width, height } = renderIcon(size);
  const png = encodePng(width, height, pixels);
  fs.writeFileSync(path.join(OUT_DIR, name), png);
  console.log(`${name} — ${size}x${size}, ${(png.length / 1024).toFixed(1)} KB`);
}

console.log('Icons written to icons/');
