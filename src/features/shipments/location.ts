import type { Fix } from './geo';

export type LocationPermission = 'granted' | 'prompt' | 'denied' | 'unsupported';

export class LocationError extends Error {
  constructor(public reason: 'denied' | 'unavailable' | 'timeout' | 'unsupported') {
    super(reason);
  }
}

/** What the browser or app WebView currently allows, without asking. */
export async function getLocationPermission(): Promise<LocationPermission> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return 'unsupported';
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return (status?.state as LocationPermission | undefined) ?? 'prompt';
  } catch {
    return 'prompt';
  }
}

/** A GPS fix from the phone. The first call is what makes the system ask the driver for access. */
export function getFix(options: { timeoutMs?: number; maxAgeMs?: number; highAccuracy?: boolean } = {}): Promise<Fix> {
  const { timeoutMs = 15_000, maxAgeMs = 0, highAccuracy = true } = options;
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return reject(new LocationError('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null, timestamp: p.timestamp }),
      (e) => reject(new LocationError(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable')),
      { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: maxAgeMs },
    );
  });
}

/** Asks for location access and reports where that leaves things. */
export async function requestLocationAccess(): Promise<LocationPermission> {
  try {
    await getFix({ timeoutMs: 20_000, maxAgeMs: 60_000, highAccuracy: false });
    return 'granted';
  } catch (e) {
    if (e instanceof LocationError && e.reason === 'denied') return 'denied';
    // Allowed, but no fix yet (indoors, GPS warming up): access itself was granted.
    return (await getLocationPermission()) === 'denied' ? 'denied' : 'granted';
  }
}
