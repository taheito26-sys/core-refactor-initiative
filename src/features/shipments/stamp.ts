import { stampLines, type StampInput } from './geo';

const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.85;
/** The storage bucket rejects anything over 5 MB. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * Burns the phone's time and GPS position into the bottom of the photo, so a picture cannot be reused
 * for another time or place. The photo is shrunk first (1600 px is plenty to read the screen). Throws when
 * the image cannot be decoded: an unstamped photo is never sent.
 */
export async function stampPhoto(file: Blob, input: StampInput): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('PHOTO_DECODE');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const lines = stampLines(input);
  let fontPx = Math.max(14, Math.round(width / 34));
  const font = (px: number) => `600 ${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.font = font(fontPx);
  // Shrink the type until the longest line fits with its padding.
  const pad = Math.round(fontPx * 0.7);
  while (fontPx > 10 && Math.max(...lines.map((l) => ctx.measureText(l).width)) > width - pad * 2) {
    fontPx -= 1;
    ctx.font = font(fontPx);
  }
  const lineHeight = Math.round(fontPx * 1.35);
  const barHeight = lineHeight * lines.length + pad * 1.4;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.66)';
  ctx.fillRect(0, height - barHeight, width, barHeight);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, pad, height - barHeight + pad * 0.7 + i * lineHeight));

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('PHOTO_DECODE');
  if (blob.size > MAX_PHOTO_BYTES) throw new Error('PHOTO_TOO_LARGE');
  return blob;
}
