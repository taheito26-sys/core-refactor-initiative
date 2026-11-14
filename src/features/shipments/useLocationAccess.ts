import { useCallback, useEffect, useRef, useState } from 'react';
import { useShipments } from './hooks';
import { getLocationPermission, requestLocationAccess, type LocationPermission } from './location';
import { CHECK_EVERY_MS } from './location-reporter';
import { canTrackInBackground, startBackgroundTracking, type BackgroundTracking } from './native-tracker';
import { getLocationReporter } from './reporting';
import type { Lang } from './route';

export interface LocationAccess {
  permission: LocationPermission | 'checking';
  /** The Android background tracker was refused or is not allowed to run. */
  backgroundDenied: boolean;
  request: () => Promise<void>;
  /** Shipments on the road that location is being reported for. */
  activeCount: number;
}

/**
 * The driver's location access, and the reporting it enables: while a shipment is on the road the
 * position goes out about every hour — from a timer while the app is open, and from an Android foreground
 * service with the screen off. Nothing is reported until the driver has allowed location.
 */
export function useLocationAccess(lang: Lang): LocationAccess {
  const { data: shipments = [] } = useShipments();
  const activeIds = shipments.filter((s) => s.status === 'on_the_road').map((s) => s.id);
  const key = activeIds.join(',');
  const [permission, setPermission] = useState<LocationPermission | 'checking'>('checking');
  const [backgroundDenied, setBackgroundDenied] = useState(false);
  const tracking = useRef<BackgroundTracking | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLocationPermission().then((p) => { if (!cancelled) setPermission(p); });
    return () => { cancelled = true; };
  }, []);

  const request = useCallback(async () => {
    setPermission(await requestLocationAccess());
  }, []);

  // Foreground reporting: check every few minutes whether an hour is up, and again whenever the app returns.
  useEffect(() => {
    const reporter = getLocationReporter();
    reporter.setShipments(permission === 'granted' ? activeIds : []);
    if (permission !== 'granted' || activeIds.length === 0) return;
    const run = () => { void reporter.tick(); };
    run();
    const timer = setInterval(run, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', run);
    window.addEventListener('focus', run);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', run);
      window.removeEventListener('focus', run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission, key]);

  // Android: keep reporting with the screen off while a trip is on the road.
  useEffect(() => {
    if (permission !== 'granted' || activeIds.length === 0 || !canTrackInBackground()) return;
    let cancelled = false;
    const text = lang === 'ar'
      ? { title: 'الرحلة جارية', message: 'يتم إرسال موقع الشاحنة كل ساعة' }
      : { title: 'Trip in progress', message: 'Sending your truck’s location every hour' };
    void startBackgroundTracking(text, (fix) => { void getLocationReporter().onBackgroundFix(fix); }, () => setBackgroundDenied(true))
      .then((t) => { if (cancelled) void t.stop(); else tracking.current = t; })
      .catch(() => setBackgroundDenied(true));
    return () => {
      cancelled = true;
      void tracking.current?.stop();
      tracking.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission, key, lang]);

  return { permission, backgroundDenied, request, activeCount: activeIds.length };
}
