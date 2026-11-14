import { supabase } from '@/integrations/supabase/client';
import { cacheKey, placeFromAddress } from '../../../supabase/functions/reverse-geocode/place';
import type { PlaceLabels } from './geo';

const LOOKUP_TIMEOUT_MS = 7_000;
const cache = new Map<string, PlaceLabels>();
const keyOf = (lat: number, lng: number) => `${lat.toFixed(2)},${lng.toFixed(2)}`;

/**
 * Names the area a position is in, in Arabic and English ("Al-Arab, Port Said"). Best effort: it returns
 * null when the lookup fails or takes too long, and the reading is sent with the coordinates alone.
 */
export async function lookupPlace(latitude: number, longitude: number): Promise<PlaceLabels | null> {
  const key = keyOf(latitude, longitude);
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const { data, error } = await Promise.race([
      supabase.functions.invoke('reverse-geocode', { body: { latitude, longitude } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), LOOKUP_TIMEOUT_MS)),
    ]);
    if (error || !data?.available) return null;
    const place: PlaceLabels = { ar: data.ar?.label ?? null, en: data.en?.label ?? null };
    if (!place.ar && !place.en) return null;
    cache.set(key, place);
    return place;
  } catch {
    return null;
  }
}

// ─── Naming old positions for the person looking at them ───

// The public geocoder allows one request a second, so every lookup waits behind the previous one.
let queue: Promise<unknown> = Promise.resolve();
const viewerCache = new Map<string, Promise<PlaceLabels | null>>();

async function fetchLabel(latitude: number, longitude: number, lang: 'ar' | 'en'): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=${lang}&lat=${latitude}&lon=${longitude}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return placeFromAddress(data?.address)?.label ?? null;
}

/**
 * Names the area of a position that was saved without one, for a merchant or customer reading it.
 * The result is "district, city, governorate, country" in both languages; null when it cannot be named.
 */
export function lookupPlaceForViewer(latitude: number, longitude: number): Promise<PlaceLabels | null> {
  const key = cacheKey(latitude, longitude);
  const hit = viewerCache.get(key);
  if (hit) return hit;
  const run = queue.then(async () => {
    try {
      const ar = await fetchLabel(latitude, longitude, 'ar');
      await new Promise((r) => setTimeout(r, 1_100));
      const en = await fetchLabel(latitude, longitude, 'en');
      await new Promise((r) => setTimeout(r, 1_100));
      return ar || en ? { ar, en } : null;
    } catch {
      return null;
    }
  });
  queue = run;
  viewerCache.set(key, run);
  // A failed lookup is retried on the next visit instead of being remembered.
  void run.then((v) => { if (!v) viewerCache.delete(key); });
  return run;
}
