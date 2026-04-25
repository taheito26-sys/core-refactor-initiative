/**
 * Generate all app icons from a single source PNG.
 *
 * Usage:
 *   node scripts/generate-icons.mjs <source-image-path>
 *
 * Example:
 *   node scripts/generate-icons.mjs public/source-icon.png
 *
 * Outputs:
 *   public/icon-512.png   (512×512)
 *   public/icon-192.png   (192×192)
 *   public/favicon.png    (512×512, same as icon-512)
 *   public/favicon.ico    (48×48 PNG-in-ICO)
 *   android/app/src/main/res/mipmap-mdpi/ic_launcher.png          (48×48)
 *   android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png
 *   android/app/src/main/res/mipmap-hdpi/ic_launcher.png          (72×72)
 *   android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png
 *   android/app/src/main/res/mipmap-xhdpi/ic_launcher.png         (96×96)
 *   android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png
 *   android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png        (144×144)
 *   android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png
 *   android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png       (192×192)
 *   android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/generate-icons.mjs <source-image.png>');
  process.exit(1);
}

// ── Web / PWA icons ──
const webIcons = [
  { out: 'public/icon-512.png', size: 512 },
  { out: 'public/icon-192.png', size: 192 },
  { out: 'public/favicon.png', size: 512 },
];

// ── Android mipmap icons ──
const androidDensities = [
  { density: 'mdpi', size: 48 },
  { density: 'hdpi', size: 72 },
  { density: 'xhdpi', size: 96 },
  { density: 'xxhdpi', size: 144 },
  { density: 'xxxhdpi', size: 192 },
];

async function run() {
  // Web icons
  for (const { out, size } of webIcons) {
    await sharp(src)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(out);
    console.log(`✓ ${out} (${size}×${size})`);
  }

  // favicon.ico — 48×48 PNG wrapped in ICO container
  const ico48 = await sharp(src)
    .resize(48, 48, { fit: 'cover' })
    .png()
    .toBuffer();
  // Simple ICO wrapper for a single 48×48 PNG image
  const icoBuffer = createIco(ico48, 48, 48);
  writeFileSync('public/favicon.ico', icoBuffer);
  console.log('✓ public/favicon.ico (48×48)');

  // Android mipmap icons
  for (const { density, size } of androidDensities) {
    const dir = `android/app/src/main/res/mipmap-${density}`;
    // ic_launcher
    await sharp(src)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(path.join(dir, 'ic_launcher.png'));
    console.log(`✓ ${dir}/ic_launcher.png (${size}×${size})`);

    // ic_launcher_foreground (adaptive icon foreground — 108/72 ratio padding)
    const fgSize = Math.round(size * (108 / 48));
    await sharp(src)
      .resize(size, size, { fit: 'cover' })
      .extend({
        top: Math.round((fgSize - size) / 2),
        bottom: Math.round((fgSize - size) / 2),
        left: Math.round((fgSize - size) / 2),
        right: Math.round((fgSize - size) / 2),
        background: { r: 15, g: 23, b: 42, alpha: 1 }, // #0f172a
      })
      .resize(fgSize, fgSize, { fit: 'cover' })
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
    console.log(`✓ ${dir}/ic_launcher_foreground.png (${fgSize}×${fgSize})`);

    // ic_launcher_round (same as ic_launcher for now)
    const roundPath = path.join(dir, 'ic_launcher_round.png');
    await sharp(src)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(roundPath);
    console.log(`✓ ${roundPath} (${size}×${size})`);
  }

  console.log('\nDone! All icons generated.');
}

/**
 * Create a minimal ICO file containing a single PNG image.
 */
function createIco(pngBuffer, width, height) {
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: 1 = ICO
  header.writeUInt16LE(1, 4);      // image count

  // Directory entry: 16 bytes
  const entry = Buffer.alloc(16);
  entry.writeUInt8(width >= 256 ? 0 : width, 0);
  entry.writeUInt8(height >= 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2);          // color palette
  entry.writeUInt8(0, 3);          // reserved
  entry.writeUInt16LE(1, 4);       // color planes
  entry.writeUInt16LE(32, 6);      // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8);  // image size
  entry.writeUInt32LE(6 + 16, 12); // offset to image data

  return Buffer.concat([header, entry, pngBuffer]);
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
