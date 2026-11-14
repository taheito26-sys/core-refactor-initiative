import { supabase } from '@/integrations/supabase/client';

export interface ScreenReading {
  temperature: number;
  setPoint: number | null;
}

const READ_TIMEOUT_MS = 25_000;
const OFF_KEY = 'shipment-reader-off:v1';
const OFF_FOR_MS = 30 * 60_000;

// The reader switches itself off for half an hour once the server says it is not configured, so a driver is
// not made to wait for a reading that will never come.
const isOff = () => {
  try { return Date.now() < Number(sessionStorage.getItem(OFF_KEY) ?? 0); } catch { return false; }
};
const markOff = () => {
  try { sessionStorage.setItem(OFF_KEY, String(Date.now() + OFF_FOR_MS)); } catch { /* not remembered; the next call asks again */ }
};

/** A small JPEG of the photo, as base64: enough to read big digits, light enough for a weak signal. */
async function toSmallBase64(photo: Blob): Promise<string> {
  const bitmap = await createImageBitmap(photo, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.75));
  if (!blob) throw new Error('encode');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Asks the server to read the temperature and set point off the photo. Returns null whenever it cannot:
 * the reader is off, the screen was unreadable, the signal is bad. The driver then types the numbers.
 */
export async function readScreen(photo: Blob): Promise<ScreenReading | null> {
  if (isOff()) return null;
  try {
    const image = await toSmallBase64(photo);
    const call = supabase.functions.invoke('read-reefer-temperature', { body: { image, mediaType: 'image/jpeg' } });
    const { data, error } = await Promise.race([
      call,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), READ_TIMEOUT_MS)),
    ]);
    if (error) return null;
    if (data?.available === false) { markOff(); return null; }
    const r = data?.reading;
    return r && typeof r.temperature === 'number' ? { temperature: r.temperature, setPoint: typeof r.setPoint === 'number' ? r.setPoint : null } : null;
  } catch {
    return null;
  }
}
