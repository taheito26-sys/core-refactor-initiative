// React hook that provides tracker state with cross-device cloud sync
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { computeFIFO, type TrackerState, type DerivedState } from './tracker-helpers';
import { createEmptyState, buildStateFrom, mergeLocalAndCloud } from './tracker-state';
import { saveTrackerState, loadTrackerStateFromCloud } from './tracker-sync';
import { getCurrentTrackerState } from './tracker-backup';
import { useAuth } from '@/features/auth/auth-context';

interface UseTrackerOptions {
  lowStockThreshold?: number;
  priceAlertThreshold?: number;
  range?: string;
  currency?: 'QAR' | 'USDT';
}

export function useTrackerState(options: UseTrackerOptions = {}) {
  const { isAuthenticated } = useAuth();
  const [cloudLoaded, setCloudLoaded] = useState(false);

  const initial = useMemo(() => createEmptyState({
    lowStockThreshold: options.lowStockThreshold,
    priceAlertThreshold: options.priceAlertThreshold,
    range: options.range,
    currency: options.currency,
  }), []);

  const [state, setState] = useState<TrackerState>(initial.state);
  const [derived, setDerived] = useState<DerivedState>(initial.derived);
  const stateRef = useRef(state);

  const applyState = useCallback((next: TrackerState) => {
    setState(next);
    stateRef.current = next;
    setDerived(computeFIFO(next.batches, next.trades));
    saveTrackerState(next);
  }, []);

  // On mount + auth, try loading from cloud and merge with local
  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;
    loadTrackerStateFromCloud().then((cloudState) => {
      if (cancelled) return;
      setCloudLoaded(true);

      if (!cloudState) {
        // No cloud state — push local to cloud
        saveTrackerState(stateRef.current);
        return;
      }

      const local = getCurrentTrackerState(window.localStorage) as Partial<TrackerState> | null;
      const best = mergeLocalAndCloud(local, cloudState);
      if (!best) return;

      const rebuilt = buildStateFrom(best, {
        lowStockThreshold: options.lowStockThreshold,
        priceAlertThreshold: options.priceAlertThreshold,
        range: options.range,
        currency: options.currency,
      });

      setState(rebuilt.state);
      stateRef.current = rebuilt.state;
      setDerived(rebuilt.derived);
      // Also update localStorage with merged state
      saveTrackerState(rebuilt.state);
    }).catch(() => {
      setCloudLoaded(true);
    });

    return () => { cancelled = true; };
  }, [isAuthenticated]);

  return { state, derived, applyState, cloudLoaded };
}
