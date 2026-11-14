import { supabase } from '@/integrations/supabase/client';
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
