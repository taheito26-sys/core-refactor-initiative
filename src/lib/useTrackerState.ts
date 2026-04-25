// React hook that provides tracker state with cross-device cloud sync
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { computeFIFO, type TrackerState, type DerivedState } from './tracker-helpers';
import { createEmptyState, buildStateFrom, mergeLocalAndCloud } from './tracker-state';
import { saveTrackerState, saveTrackerStateNow, loadTrackerStateFromCloud } from './tracker-sync';
import { getCurrentTrackerState } from './tracker-backup';
import { useAuth } from '@/features/auth/auth-context';
import { saveCashToCloud, loadCashFromCloud } from './cash-sync';
import { triggerVaultBackup } from './vault-auto-trigger';
import { supabase } from '@/integrations/supabase/client';

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
    // Always sync to dedicated cash tables — including empty arrays, so a
    // "clear all cash" propagates the deletes (full reconcile) to the cloud.
    if (cashSaveTimer.current) clearTimeout(cashSaveTimer.current);
    cashSaveTimer.current = setTimeout(() => {
      saveCashToCloud(next.cashAccounts ?? [], next.cashLedger ?? [])
        .catch(err => console.error('[useTrackerState] saveCashToCloud failed:', err));
    }, 500);
  }, [adminMode, options.preloadedState]);

  /**
   * Commit-first variant: writes to the DB synchronously (tracker_snapshots
   * + cash tables) and only updates React/localStorage state AFTER the
   * server acknowledges. Throws on failure so the caller can abort its
   * success toast and surface the error instead.
   *
   * Use this for merchant-facing mutations (add stock, add cash, record
   * trade) where "done" must mean "durable on the server," not "saved
   * locally and maybe uploaded later."
   */
  const applyStateAndCommit = useCallback(async (next: TrackerState): Promise<void> => {
    if (adminMode || options.preloadedState) {
      setState(next);
      stateRef.current = next;
      setDerived(computeFIFO(next.batches, next.trades));
      return;
    }
    const prev = stateRef.current;

    // Write to DB FIRST — if this throws, React state is not mutated.
    await saveTrackerStateNow(next);
    // Always reconcile cash tables (including empty) so deletes propagate.
    await saveCashToCloud(next.cashAccounts ?? [], next.cashLedger ?? []);

    // Server acknowledged — now update UI.
    setState(next);
    stateRef.current = next;
    setDerived(computeFIFO(next.batches, next.trades));
    triggerVaultBackup(diffTrackerReason(prev, next));
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

  // Pulls the latest merchant-wide state from cloud and merges into React
  // state. Used both on initial mount and on realtime postgres_changes events
  // so desktop mutations appear on mobile (and vice versa) without reload.
  const refreshFromCloud = useCallback(async () => {
    try {
      const cloudState = await loadTrackerStateFromCloud();
      if (cloudState) {
        // Cash lives in dedicated cash_accounts / cash_ledger tables — strip
        // any stale copies from the snapshot so the snapshot can never bring
        // cleared cash back to life.
        const cloudStateNoCash: Partial<TrackerState> = {
          ...cloudState,
          cashAccounts: [],
          cashLedger: [],
        };
        const inFlight: Partial<TrackerState> = {
          ...stateRef.current,
          cashAccounts: [],
          cashLedger: [],
        };
        const best = mergeLocalAndCloud(inFlight, cloudStateNoCash);
        if (best) {
          // Preserve the current in-memory cash arrays through the rebuild;
          // they will be replaced by the cash-table load below.
          const preserved = {
            ...best,
            cashAccounts: stateRef.current.cashAccounts ?? [],
            cashLedger: stateRef.current.cashLedger ?? [],
          };
          const rebuilt = buildStateFrom(preserved, {
            lowStockThreshold: options.lowStockThreshold,
            priceAlertThreshold: options.priceAlertThreshold,
            range: options.range,
            currency: options.currency,
          });
          setState(rebuilt.state);
          stateRef.current = rebuilt.state;
          setDerived(rebuilt.derived);
          saveTrackerState(rebuilt.state);
        }
      }
      // Dedicated cash tables are AUTHORITATIVE. Always apply the result —
      // even when both arrays are empty — so a clear on one device propagates.
      const cashData = await loadCashFromCloud();
      if (cashData) {
        setState(prev => {
          const next = {
            ...prev,
            cashAccounts: cashData.accounts,
            cashLedger: cashData.ledger,
          };
          stateRef.current = next;
          return next;
        });
      }
    } catch (err) {
      console.error('[useTrackerState] refreshFromCloud failed:', err);
    }
  }, [options.lowStockThreshold, options.priceAlertThreshold, options.range, options.currency]);

  // Realtime: when tracker_snapshots / cash_accounts / cash_ledger change for
  // this user, re-fetch and re-merge so another device's writes appear
  // live without a page refresh. Debounced 500ms to coalesce bursts.
  useEffect(() => {
    if (adminMode || options.preloadedState) return;
    if (!isAuthenticated) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { void refreshFromCloud(); }, 500);
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      // Resolve all merchant team member user_ids BEFORE creating the channel.
      // Supabase Realtime silently ignores any .on() registered after .subscribe(),
      // so every watched user_id must be wired in before the single subscribe() call.
      const watchIds: string[] = [user.id];
      try {
        const { data: ownProfile } = await supabase
          .from('merchant_profiles')
          .select('merchant_id')
          .eq('user_id', user.id)
          .maybeSingle();
        const mid = (ownProfile as { merchant_id?: string } | null)?.merchant_id;
        if (mid) {
          const { data: members } = await supabase
            .from('merchant_profiles')
            .select('user_id')
            .eq('merchant_id', mid);
          for (const m of (members || []) as { user_id?: string }[]) {
            if (m.user_id && m.user_id !== user.id) watchIds.push(m.user_id);
          }
        }
      } catch (err) {
        console.error('[useTrackerState] failed to resolve merchant members for realtime:', err);
      }

      if (cancelled) return;

      let ch = supabase.channel(`tracker-state-sync-${user.id}`);
      for (const id of watchIds) {
        ch = ch
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tracker_snapshots', filter: `user_id=eq.${id}` }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_accounts', filter: `user_id=eq.${id}` }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_ledger', filter: `user_id=eq.${id}` }, scheduleRefresh);
      }
      channel = ch.subscribe();
    })();

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [adminMode, isAuthenticated, options.preloadedState, refreshFromCloud]);

  // On mount + auth, try loading from cloud and merge with local
  useEffect(() => {
    if (adminMode || options.preloadedState) return; // skip cloud sync in admin mode
    if (!isAuthenticated) return;

    let cancelled = false;
    loadTrackerStateFromCloud().then((cloudState) => {
      if (cancelled) return;
      setCloudLoaded(true);

      if (!cloudState) {
        // No cloud state yet. Only push local if it actually has data —
        // a fresh PWA install with empty localStorage must NOT upload an
        // empty row that would later be mistaken for "cloud has nothing".
        const s = stateRef.current;
        const hasData =
          (s.batches?.length ?? 0) > 0 ||
          (s.trades?.length ?? 0) > 0 ||
          (s.customers?.length ?? 0) > 0 ||
          (s.cashAccounts?.length ?? 0) > 0 ||
          (s.cashLedger?.length ?? 0) > 0;
        if (hasData) saveTrackerState(s);
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
        // Cash tables are authoritative — replace state's cash arrays even
        // when empty (the only way a "clear cash" propagates across devices).
        setState(prev => {
          const next = {
            ...prev,
            cashAccounts: cashData.accounts,
            cashLedger: cashData.ledger,
          };
          stateRef.current = next;
          return next;
        });
      }).catch((err) => { console.error('[useTrackerState] cash cloud sync failed:', err); });
    }).catch((err) => {
      console.error('[useTrackerState] cloud load failed:', err);
      setCloudLoaded(true);
    });

    return () => { cancelled = true; };
  }, [adminMode, isAuthenticated, options.preloadedState]);

  return { state, derived, applyState, applyStateAndCommit, cloudLoaded };
}
