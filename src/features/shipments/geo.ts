import type { Lang } from './route';

export interface Fix {
  latitude: number;
  longitude: number;
  /** Metres, when the device reports it. */
  accuracy: number | null;
  /** When the phone took the fix (epoch ms). */
  timestamp: number;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(a: Pick<Fix, 'latitude' | 'longitude'>, b: Pick<Fix, 'latitude' | 'longitude'>): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** "25.28540°N 51.53100°E": signed decimal degrees are easy to misread on a photo. */
export function formatCoords(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(5)}°${latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(longitude).toFixed(5)}°${longitude >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The phone's own local time with its UTC offset, e.g. "14 Nov 2026 16:42:07 UTC+3". */
export function formatStampTime(ms: number, offsetMinutes: number = -new Date(ms).getTimezoneOffset()): string {
  const d = new Date(ms + offsetMinutes * 60_000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const offset = `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${pad(abs % 60)}` : ''}`;
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${offset}`;
}

export interface StampInput {
  capturedAt: number;
  fix: Pick<Fix, 'latitude' | 'longitude' | 'accuracy'>;
  reference: string;
  driverName?: string | null;
}

/** The two lines burned into the bottom of every reefer photo. */
export function stampLines({ capturedAt, fix, reference, driverName }: StampInput): [string, string] {
  const accuracy = fix.accuracy != null ? ` ±${Math.round(fix.accuracy)} m` : '';
  return [
    `${formatStampTime(capturedAt)}  ·  ${reference}${driverName ? `  ·  ${driverName}` : ''}`,
    `${formatCoords(fix.latitude, fix.longitude)}${accuracy}`,
  ];
}

export type EntryMode = 'auto' | 'auto_edited' | 'manual';

/**
 * How the final numbers came about: untouched from the automatic reader, corrected by the driver, or typed
 * with no reading at all. Stored with the reading so the customer can see how much to trust it.
 */
export function deriveEntryMode(
  read: { temperature: number; setPoint: number | null } | null,
  finalTemperature: number,
  finalSetPoint: number | null,
): EntryMode {
  if (!read) return 'manual';
  // A set point the reader could not see is not "edited" just because the driver left the default in place.
  const setPointKept = read.setPoint === null || read.setPoint === finalSetPoint;
  return read.temperature === finalTemperature && setPointKept ? 'auto' : 'auto_edited';
}

export const ENTRY_MODE_LABELS: Record<EntryMode, { en: string; ar: string }> = {
  auto: { en: 'Read from the photo', ar: 'قُرئت من الصورة' },
  auto_edited: { en: 'Read, then corrected by the driver', ar: 'قُرئت ثم صححها السائق' },
  manual: { en: 'Typed by the driver', ar: 'أدخلها السائق' },
};

/** An OpenStreetMap embed centred on a point, no map library needed. */
export function mapEmbedUrl(latitude: number, longitude: number): string {
  const dLat = 0.03;
  const dLon = 0.05;
  const bbox = [longitude - dLon, latitude - dLat, longitude + dLon, latitude + dLat].map((n) => n.toFixed(5)).join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

export const mapsLink = (latitude: number, longitude: number) =>
  `https://www.google.com/maps?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`;

export const LOCATION_SOURCE_LABELS: Record<'auto' | 'reading' | 'stop', { en: string; ar: string }> = {
  auto: { en: 'hourly update', ar: 'تحديث كل ساعة' },
  reading: { en: 'temperature photo', ar: 'صورة الحرارة' },
  stop: { en: 'stop confirmed', ar: 'تأكيد محطة' },
};

/** True when a fix is recent enough to stamp onto a photo taken now. */
export function isFreshFix(fix: Pick<Fix, 'timestamp'>, now: number, maxAgeMs: number): boolean {
  return now - fix.timestamp <= maxAgeMs && fix.timestamp <= now + 60_000;
}

export type { Lang };
