import { logLocation } from './api';
import { getFix } from './location';
import { LocationReporter } from './location-reporter';

let reporter: LocationReporter | null = null;

/** One reporter for the whole app, so a stop or a reading can reset the same hourly clock the timer uses. */
export function getLocationReporter(): LocationReporter {
  if (!reporter) {
    reporter = new LocationReporter({
      getFix: async () => {
        try {
          return await getFix({ timeoutMs: 20_000, maxAgeMs: 5 * 60_000, highAccuracy: false });
        } catch {
          return null;
        }
      },
      send: async (p) => {
        await logLocation(p);
      },
      now: () => Date.now(),
      storage: window.localStorage,
    });
  }
  return reporter;
}

/** A position sent with a confirmed stop. Best effort: the stop itself never waits on GPS. */
export async function reportStopLocation(shipmentId: string): Promise<void> {
  try {
    const fix = await getFix({ timeoutMs: 8_000, maxAgeMs: 120_000, highAccuracy: false });
    await logLocation({ shipmentId, latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy, recordedAt: fix.timestamp, source: 'stop' });
    getLocationReporter().noteReported(shipmentId);
  } catch {
    // The hourly report will carry the position instead.
  }
}
