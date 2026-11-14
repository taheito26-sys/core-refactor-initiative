export interface PlaceName {
  district: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  /** District, city, region and country joined, without repeats: "Al-Arab, Port Said, Port Said Governorate, Egypt". */
  label: string;
}

const first = (...values: unknown[]): string | null => {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
};

/** Turns an OpenStreetMap reverse-geocoding answer into the names a person would say. */
export function placeFromAddress(address: Record<string, unknown> | null | undefined): PlaceName | null {
  if (!address || typeof address !== 'object') return null;
  const district = first(address.suburb, address.city_district, address.neighbourhood, address.quarter, address.borough);
  const city = first(address.city, address.town, address.village, address.municipality, address.county);
  const region = first(address.state, address.state_district, address.region);
  const country = first(address.country);
  const parts: string[] = [];
  for (const p of [district, city, region, country]) if (p && !parts.includes(p)) parts.push(p);
  if (parts.length === 0) return null;
  return { district, city, region, country, label: parts.join(', ') };
}

/** Two nearby points share one answer: about a kilometre is plenty for "which area is this". */
export const cacheKey = (lat: number, lng: number) => `${lat.toFixed(2)},${lng.toFixed(2)}`;

export const validCoordinates = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
