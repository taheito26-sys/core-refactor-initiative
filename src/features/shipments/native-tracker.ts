import { registerPlugin } from '@capacitor/core';
import { isAndroid } from '@/platform/runtime';
import type { Fix } from './geo';

// Described here rather than imported: the plugin only exists in the Android app.
interface BackgroundLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  /** Epoch ms, or null when the platform gives none. */
  time: number | null;
}
interface BackgroundError extends Error {
  code?: string;
}
interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (location?: BackgroundLocation, error?: BackgroundError) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

const plugin = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

/** Only the Android app can keep reporting with the screen off; a browser tab cannot. */
export const canTrackInBackground = (): boolean => isAndroid();

export const openLocationSettings = () => plugin.openSettings();

export interface BackgroundTracking {
  stop: () => Promise<void>;
}

/**
 * Starts the Android foreground service that keeps location running with the screen off (shown to the
 * driver as a permanent "trip in progress" notification). Each movement of 100 m or more is handed over;
 * the reporter decides whether an hour has passed and a point is due.
 */
export async function startBackgroundTracking(
  text: { title: string; message: string },
  onFix: (fix: Fix) => void,
  onDenied: () => void,
): Promise<BackgroundTracking> {
  const id = await plugin.addWatcher(
    { backgroundTitle: text.title, backgroundMessage: text.message, requestPermissions: true, stale: false, distanceFilter: 100 },
    (location, error) => {
      if (error) {
        if (error.code === 'NOT_AUTHORIZED') onDenied();
        return;
      }
      if (location) onFix({ latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy ?? null, timestamp: location.time ?? Date.now() });
    },
  );
  return { stop: () => plugin.removeWatcher({ id }) };
}
