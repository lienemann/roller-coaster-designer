// SPDX-License-Identifier: AGPL-3.0-only

// Render PWA icons from public/icon.svg via sharp.
//
// Outputs (all into public/):
//   icon-192.png         192×192, "any" purpose (Android home screen)
//   icon-512.png         512×512, "any" purpose
//   icon-maskable-512.png 512×512, with 10% safe-area padding so Android's
//                         circle/squircle/superellipse mask doesn't crop the
//                         glyph
//   apple-touch-icon.png 180×180, opaque, used by iOS Safari ("add to Home
//                         screen") — manifest icons are ignored on iOS
//   favicon-32.png       32×32, used as the browser-tab favicon fallback

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(here, '../public');
const SVG_PATH = resolve(PUBLIC_DIR, 'icon.svg');

const BG = { r: 11, g: 11, b: 11, alpha: 1 };

async function renderAny(size, name) {
  const out = resolve(PUBLIC_DIR, name);
  await sharp(SVG_PATH).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
  return out;
}

async function renderMaskable(size, name) {
  // Maskable icons need a safe area: the inner 80 % of the canvas is what
  // every Android masking shape (circle, squircle, superellipse) is
  // guaranteed to keep visible. Render the SVG at 80 % size and centre it
  // on a full-bleed background.
  const inner = Math.round(size * 0.8);
  const offset = Math.round((size - inner) / 2);
  const fg = await sharp(SVG_PATH).resize(inner, inner).png().toBuffer();
  const out = resolve(PUBLIC_DIR, name);
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: fg, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toFile(out);
  return out;
}

async function renderOpaque(size, name) {
  // iOS apple-touch-icon must be opaque (Safari adds rounded corners and
  // doesn't honor transparency well). Composite the SVG over an opaque
  // background of the theme colour.
  const fg = await sharp(SVG_PATH).resize(size, size).png().toBuffer();
  const out = resolve(PUBLIC_DIR, name);
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: fg }])
    .png({ compressionLevel: 9 })
    .toFile(out);
  return out;
}

async function main() {
  await mkdir(PUBLIC_DIR, { recursive: true });
  const outputs = await Promise.all([
    renderAny(192, 'icon-192.png'),
    renderAny(512, 'icon-512.png'),
    renderMaskable(512, 'icon-maskable-512.png'),
    renderOpaque(180, 'apple-touch-icon.png'),
    renderOpaque(32, 'favicon-32.png'),
  ]);
  for (const o of outputs) {
    process.stdout.write(`${o}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`build-icons failed: ${err.stack ?? err.message ?? err}\n`);
  process.exit(1);
});
