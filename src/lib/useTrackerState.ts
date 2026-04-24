// React hook that provides tracker state with cross-device cloud sync
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { computeFIFO, type TrackerState, type DerivedState } from './tracker-helpers';
import { createEmptyState, buildStateFrom, mergeLocalAndCloud } from './tracker-state';
import { saveTrackerState, loadTrackerStateFromCloud } from './tracker-sync';
import { getCurrentTrackerState } from './tracker-backup';
import { useAuth } from '@/features/auth/auth-context';
import { saveCashToCloud, loadCashFromCloud } from './cash-sync';
import { triggerVaultBackup } from './vault-auto-trigger';

function diffTrackerReason(prev: TrackerState, next: TrackerState): string {
  const parts: string[] = [];
  const pair = (key: keyof TrackerState, singular: string) => {
    const p = (prev[key] as unknown[] | undefined)?.length ?? 0;
    const n = (next[key] as unknown[] | undefined)?.length ?? 0;
    if (n > p) parts.push(`${singular} added`);
    else if (n < p) parts.push(`${singular} removed`);
  };
  pair('batches', 'batch');
  pair('trades', 'trade');
  pair('customers', 'customer');
  pair('suppliers', 'supplier');
  pair('cashAccounts', 'cash account');
  pair('cashLedger', 'cash entry');
  if (parts.length === 0) {
    // Same counts — likely edit/settings/cash balance change
    if ((prev.cashQAR ?? 0) !== (next.cashQAR ?? 0)) return 'cash balance updated';
    return 'settings updated';
  }
  return parts.join(', ');
}

interface UseTrackerOptions {
  lowStockThreshold?: number;
  priceAlertThreshold?: number;
  range?: string;
  currency?: 'QAR' | 'EGP' | 'USDT';
  disableCloudSync?: boolean;
  /** When provided (admin view), skip cloud sync and use this state directly */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  preloadedState?: any;
}

export function useTrackerState(options: UseTrackerOptions = {}) {
  const { isAuthenticated } = useAuth();
  const [cloudLoaded, setCloudLoaded] = useState(options.disableCloudSync ? true : false);
  const adminMode = Boolean(options.disableCloudSync);

  const initial = useMemo(() => {
    const base = {
      lowStockThreshold: options.lowStockThreshold,
      priceAlertThreshold: options.priceAlertThreshold,
      range: options.range,
      currency: options.currency,
    };

    if (adminMode) {
      return options.preloadedState
        ? buildStateFrom(options.preloadedState, base)
        : buildStateFrom(null, base);
    }

    return createEmptyState(base);
  }, [adminMode, options.preloadedState, options.lowStockThreshold, options.priceAlertThreshold, options.range, options.currency]);

  const [state, setState] = useState<TrackerState>(initial.state);
  const [derived, setDerived] = useState<DerivedState>(initial.derived);
  const stateRef = useRef(state);
  const cashSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyState = useCallback((next: TrackerState) => {
    // In admin preloaded mode, don't persist
    if (adminMode || options.preloadedState) {
      setState(next);
      stateRef.current = next;
      setDerived(computeFIFO(next.batches, next.trades));
      return;
    }
    const prev = stateRef.current;
    setState(next);
    stateRef.current = next;
    setDerived(computeFIFO(next.batches, next.trades));
    saveTrackerState(next);
    triggerVaultBackup(diffTrackerReason(prev, next));
    // Debounced sync to dedicated cash tables
    if (next.cashAccounts?.length || next.cashLedger?.length) {
      if (cashSaveTimer.current) clearTimeout(cashSaveTimer.current);
      cashSaveTimer.current = setTimeout(() => {
        saveCashToCloud(next.cashAccounts ?? [], next.cashLedger ?? [])
          .catch(err => console.error('[useTrackerState] saveCashToCloud failed:', err));
      }, 500);
    }
  }, [adminMode, options.preloadedState]);

  // Handle preloaded state (admin view)
  useEffect(() => {
    if (!adminMode && !options.preloadedState) return;
    const ps = options.preloadedState;
    const rebuilt = buildStateFrom(ps, {
      lowStockThreshold: options.lowStockThreshold,
      priceAlertThreshold: options.priceAlertThreshold,
      range: options.range,
      currency: options.currency,
    });
    setState(rebuilt.state);
    stateRef.current = rebuilt.state;
    setDerived(rebuilt.derived);
    setCloudLoaded(true);
  }, [adminMode, options.preloadedState, options.lowStockThreshold, options.priceAlertThreshold, options.range, options.currency]);

  // On mount + auth, try loading from cloud and merge with local
  useEffect(() => {
    if (adminMode || options.preloadedState) return; // skip cloud sync in admin mode
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

      // Merge against the in-memory ref (which already contains any changes the
      // user made between mount and now). Falling back to localStorage would
      // miss in-flight mutations on devices where Safari has wiped storage or
      // the user interacted before the first persistToLocal flushed.
      const inFlight = stateRef.current as Partial<TrackerState>;
      const local = getCurrentTrackerState(window.localStorage) as Partial<TrackerState> | null;
      const localUnion = mergeLocalAndCloud(local, inFlight);
      const best = mergeLocalAndCloud(localUnion, cloudState);
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
      // Also update localStorage AND push merged state back to cloud so any
      // in-flight local-only rows are uploaded.
      saveTrackerState(rebuilt.state);

      // Load dedicated cash tables and merge with local state (prefer cloud, keep local-only entries)
      // ISSUE 6 FIX: previously stateRef.current was never updated after the
      // async setState callback, so any call to applyState() that happened
      // immediately after the cash merge would read stale pre-cash data from
      // stateRef.current and overwrite the cloud cash values when persisting.
      loadCashFromCloud().then(cashData => {
        if (!cashData) return;
        if (cashData.accounts.length === 0 && cashData.ledger.length === 0) return;
        setState(prev => {
          const cloudIds = new Set(cashData.ledger.map((e: { id: string }) => e.id));
          const localOnly = (prev.cashLedger || []).filter(e => !cloudIds.has(e.id));
          // Merge accounts by ID: prefer cloud for existing accounts, keep local-only accounts
          const cloudAccountIds = new Set(cashData.accounts.map((a: { id: string }) => a.id));
          const localOnlyAccounts = (prev.cashAccounts || []).filter(a => !cloudAccountIds.has(a.id));
          const next = {
            ...prev,
            cashAccounts: [...cashData.accounts, ...localOnlyAccounts],
            cashLedger: [...cashData.ledger, ...localOnly],
          };
          stateRef.current = next;   // ← ISSUE 6 FIX: keep ref in sync with merged cash state
          return next;
        });
      }).catch((err) => { console.error('[useTrackerState] cash cloud sync failed:', err); });
    }).catch((err) => {
      console.error('[useTrackerState] cloud load failed:', err);
      setCloudLoaded(true);
    });

    return () => { cancelled = true; };
  }, [adminMode, isAuthenticated, options.preloadedState]);

  return { state, derived, applyState, cloudLoaded };
}
