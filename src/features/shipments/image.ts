const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.82;
/** The storage bucket rejects anything over 5 MB. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * Shrinks a camera photo before upload: a phone photo of the reefer screen is several MB, and the
 * screen stays perfectly readable at 1600 px on the long edge. Returns the original when the browser
 * cannot decode or re-encode it and it is already small enough.
 */
export async function compressPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas context');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (blob) return blob;
  } catch {
    // fall through to the original file
  }
  if (file.size > MAX_PHOTO_BYTES) throw new Error('PHOTO_TOO_LARGE');
  return file;
}
