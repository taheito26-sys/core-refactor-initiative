// React hook that provides tracker state with cross-device cloud sync
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { computeFIFO, type TrackerState, type DerivedState } from './tracker-helpers';
import { createEmptyState, buildStateFrom, mergeLocalAndCloud } from './tracker-state';
import { saveTrackerState, saveTrackerStateNow, loadTrackerStateFromCloud } from './tracker-sync';
import { getCurrentTrackerState, hasTrackerItems } from './tracker-backup';
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
  // Tracks account IDs whose ledger was just cleared — prevents refreshFromCloud
  // from re-merging local-only entries for those accounts during the sync window.
  const clearedAccountIds = useRef<Set<string>>(new Set());

  function isWriteBlocked(): boolean {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('tracker_data_cleared') === 'true';
    } catch {
      return false;
    }
  }

  function guardedSetState(next: TrackerState | ((prev: TrackerState) => TrackerState)): boolean {
    const resolved = typeof next === 'function' ? next(stateRef.current) : next;
    if (isWriteBlocked() && hasTrackerItems(resolved)) {
      return false;
    }

    setState(resolved);
    stateRef.current = resolved;
    setDerived(computeFIFO(resolved.batches, resolved.trades));
    return true;
  }

  const applyState = useCallback((next: TrackerState) => {
    // In admin preloaded mode, don't persist
    if (adminMode || options.preloadedState) {
      guardedSetState(next);
      return;
    }
    const prev = stateRef.current;
    if (!guardedSetState(next)) return;
    saveTrackerState(next);
    triggerVaultBackup(diffTrackerReason(prev, next));
    // Debounced sync to dedicated cash tables
    if (next.cashAccounts?.length || next.cashLedger?.length) {
      if (cashSaveTimer.current) clearTimeout(cashSaveTimer.current);
      cashSaveTimer.current = setTimeout(() => {
        saveCashToCloud(next.cashAccounts ?? [], next.cashLedger ?? [])
          .catch(err => console.error('[useTrackerState] saveCashToCloud failed:', err));
      }, 500);
    } else if (cashSaveTimer.current) {
      clearTimeout(cashSaveTimer.current);
      cashSaveTimer.current = null;
    }
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
      guardedSetState(next);
      return;
    }
    const prev = stateRef.current;

    // Write to DB FIRST — if this throws, React state is not mutated.
    await saveTrackerStateNow(next);
    if (next.cashAccounts?.length || next.cashLedger?.length) {
      await saveCashToCloud(next.cashAccounts ?? [], next.cashLedger ?? []);
    } else if (cashSaveTimer.current) {
      clearTimeout(cashSaveTimer.current);
      cashSaveTimer.current = null;
    }

    // Server acknowledged — now update UI.
    guardedSetState(next);
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
    guardedSetState(rebuilt.state);
    setCloudLoaded(true);
  }, [adminMode, options.preloadedState, options.lowStockThreshold, options.priceAlertThreshold, options.range, options.currency]);

  // Pulls the latest merchant-wide state from cloud and merges into React
  // state. Used both on initial mount and on realtime postgres_changes events
  // so desktop mutations appear on mobile (and vice versa) without reload.
  const refreshFromCloud = useCallback(async () => {
    try {
      const cloudState = await loadTrackerStateFromCloud();
      if (cloudState) {
        const inFlight = stateRef.current as Partial<TrackerState>;
        const best = mergeLocalAndCloud(inFlight, cloudState);
        if (best) {
          const rebuilt = buildStateFrom(best, {
            lowStockThreshold: options.lowStockThreshold,
            priceAlertThreshold: options.priceAlertThreshold,
            range: options.range,
            currency: options.currency,
          });
          guardedSetState(rebuilt.state);
          saveTrackerState(rebuilt.state);
        }
      }
      const cashData = await loadCashFromCloud();
      if (cashData) {
        guardedSetState(prev => {
          // Cloud is authoritative for cash ledger.
          // Only keep local entries that are genuinely newer than the cloud fetch
          // (i.e. added in the last 2s) — this covers the race where a user adds
          // an entry and the realtime event fires before saveCashToCloud completes.
          const cloudIds = new Set(cashData.ledger.map(e => e.id));
          const twoSecondsAgo = Date.now() - 2000;
          const localOnly = (prev.cashLedger || []).filter(e =>
            !cloudIds.has(e.id) &&
            !clearedAccountIds.current.has(e.accountId) &&
            e.ts > twoSecondsAgo
          );
          const cloudAccountIds = new Set(cashData.accounts.map(a => a.id));
          const localOnlyAccounts = (prev.cashAccounts || []).filter(a => !cloudAccountIds.has(a.id));
          const next = {
            ...prev,
            cashAccounts: [...cashData.accounts, ...localOnlyAccounts],
            cashLedger: [...cashData.ledger, ...localOnly],
          };
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

    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !user) return;
      channel = supabase
        .channel(`tracker-state-sync-${user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tracker_snapshots', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_accounts', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_ledger', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
        .subscribe();

      // Also listen to other members of the same merchant group
      void supabase
        .from('merchant_profiles')
        .select('merchant_id')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          const mid = (data as { merchant_id?: string } | null)?.merchant_id;
          if (!mid || !channel) return;
          void supabase
            .from('merchant_profiles')
            .select('user_id')
            .eq('merchant_id', mid)
            .then(({ data: members }) => {
              const memberIds = (members || [])
                .map((m: { user_id?: string }) => m.user_id)
                .filter((id): id is string => !!id && id !== user.id);
              for (const memberId of memberIds) {
                if (!channel) break;
                channel.on(
                  'postgres_changes',
                  { event: '*', schema: 'public', table: 'tracker_snapshots', filter: `user_id=eq.${memberId}` },
                  scheduleRefresh,
                );
              }
            });
        });
    });

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

      guardedSetState(rebuilt.state);
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
        guardedSetState(prev => {
          const cloudIds = new Set(cashData.ledger.map((e: { id: string }) => e.id));
          // Cloud is authoritative — only keep local entries added in the last 2s
          // (in-flight entries that haven't synced yet). This prevents cleared
          // entries from being restored on mount.
          const twoSecondsAgo = Date.now() - 2000;
          const localOnly = (prev.cashLedger || []).filter(e =>
            !cloudIds.has(e.id) &&
            !clearedAccountIds.current.has(e.accountId) &&
            e.ts > twoSecondsAgo
          );
          const cloudAccountIds = new Set(cashData.accounts.map((a: { id: string }) => a.id));
          const localOnlyAccounts = (prev.cashAccounts || []).filter(a => !cloudAccountIds.has(a.id));
          const next = {
            ...prev,
            cashAccounts: [...cashData.accounts, ...localOnlyAccounts],
            cashLedger: [...cashData.ledger, ...localOnly],
          };
          return next;
        });
      }).catch((err) => { console.error('[useTrackerState] cash cloud sync failed:', err); });
    }).catch((err) => {
      console.error('[useTrackerState] cloud load failed:', err);
      setCloudLoaded(true);
    });

    return () => { cancelled = true; };
  }, [adminMode, isAuthenticated, options.preloadedState]);

  return { state, derived, applyState, applyStateAndCommit, cloudLoaded, clearedAccountIds };
}
