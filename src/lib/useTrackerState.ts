// React hook that provides tracker state with cross-device cloud sync
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { computeFIFO, type TrackerState, type DerivedState } from './tracker-helpers';
import { createEmptyState, buildStateFrom, mergeLocalAndCloud } from './tracker-state';
import { saveTrackerState, saveTrackerStateNow, loadTrackerStateFromCloud } from './tracker-sync';
import { getCurrentTrackerState, getTrackerWriteGeneration, isTrackerDataCleared, activateTrackerClearBarrier } from './tracker-backup';
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
      return typeof window !== 'undefined' && isTrackerDataCleared(window.localStorage);
    } catch {
      return false;
    }
  }

  function isExplicitClearPayload(value: TrackerState): boolean {
    const record = value as Record<string, unknown>;
    const dataKeys = ['batches', 'trades', 'customers', 'suppliers', 'cashAccounts', 'cashLedger', 'cashHistory'] as const;
    if (dataKeys.some((key) => Array.isArray(record[key]) && (record[key] as unknown[]).length > 0)) {
      return false;
    }
    const cashQAR = Number(record.cashQAR ?? 0);
    if (!Number.isFinite(cashQAR) || cashQAR !== 0) return false;
    const cashOwner = record.cashOwner;
    if (typeof cashOwner === 'string' && cashOwner.trim() !== '') return false;
    return true;
  }

  function guardedSetState(
    next: TrackerState | ((prev: TrackerState) => TrackerState),
    meta: { allowDuringClear?: boolean; expectedGeneration?: number } = {},
  ): boolean {
    const currentGeneration = getTrackerWriteGeneration();
    if (meta.expectedGeneration !== undefined && meta.expectedGeneration !== currentGeneration) {
      return false;
    }

    const resolved = typeof next === 'function' ? next(stateRef.current) : next;
    if (isWriteBlocked() && !meta.allowDuringClear) {
      return false;
    }
    if (meta.allowDuringClear && !isExplicitClearPayload(resolved)) {
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
    // Debounced sync to dedicated cash tables — always fire so deletions
    // (empty arrays) propagate to the cloud and other devices see the clear.
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
      guardedSetState(next);
      return;
    }
    const prev = stateRef.current;

    // Write to DB FIRST — if this throws, React state is not mutated.
    await saveTrackerStateNow(next);
    // Always sync cash tables — empty arrays propagate deletions to other devices.
    await saveCashToCloud(next.cashAccounts ?? [], next.cashLedger ?? []);
    if (cashSaveTimer.current) {
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
    const requestGeneration = getTrackerWriteGeneration();
    try {
      const cloudSnapshot = await loadTrackerStateFromCloud();
      if (requestGeneration !== getTrackerWriteGeneration()) return;
      if (cloudSnapshot?.cleared) {
        console.info(
          `[refresh] cleared tombstone — gen=${cloudSnapshot.writeGeneration} updatedAt=${cloudSnapshot.updatedAt ?? 'n/a'} — wiping to empty state`,
        );
        activateTrackerClearBarrier(window.localStorage);
        const empty = buildStateFrom({}, {
          lowStockThreshold: options.lowStockThreshold,
          priceAlertThreshold: options.priceAlertThreshold,
          range: options.range,
          currency: options.currency,
        });
        guardedSetState(empty.state, { expectedGeneration: requestGeneration, allowDuringClear: true });
        return;
      }
      const cloudState = cloudSnapshot?.state ?? null;
      if (cloudState) {
        const inFlight = stateRef.current as Partial<TrackerState>;
        // Strip cash fields from the tracker_snapshots merge — cash data is
        // owned exclusively by the dedicated cash_accounts / cash_ledger tables
        // (loaded below via loadCashFromCloud). Merging stale cash arrays from
        // tracker_snapshots would overwrite the correct dedicated-table data.
        const cloudStateNoCash = {
          ...cloudState,
          cashAccounts: undefined,
          cashLedger: undefined,
          cashHistory: undefined,
          cashQAR: undefined,
        } as Partial<TrackerState>;
        const inFlightNoCash = {
          ...inFlight,
          cashAccounts: undefined,
          cashLedger: undefined,
          cashHistory: undefined,
          cashQAR: undefined,
        } as Partial<TrackerState>;
        const best = mergeLocalAndCloud(inFlightNoCash, cloudStateNoCash);
        if (best) {
          const rebuilt = buildStateFrom(best, {
            lowStockThreshold: options.lowStockThreshold,
            priceAlertThreshold: options.priceAlertThreshold,
            range: options.range,
            currency: options.currency,
          });
          // Preserve current cash state — it will be overwritten by loadCashFromCloud below
          const withCash: TrackerState = {
            ...rebuilt.state,
            cashAccounts: stateRef.current.cashAccounts,
            cashLedger: stateRef.current.cashLedger,
            cashQAR: stateRef.current.cashQAR,
          };
          guardedSetState(withCash, { expectedGeneration: requestGeneration });
          saveTrackerState(withCash);
        }
      }
      const cashData = await loadCashFromCloud();
      if (requestGeneration !== getTrackerWriteGeneration()) return;
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
        }, { expectedGeneration: requestGeneration });
      }
    } catch (err) {
      console.error('[useTrackerState] refreshFromCloud failed:', err);
    }
  }, [options.lowStockThreshold, options.priceAlertThreshold, options.range, options.currency]);

  // Realtime: when tracker_snapshots / cash_accounts / cash_ledger change for
  // this user OR any merchant team member, re-fetch and re-merge so another
  // device's writes appear live without a page refresh. Debounced 500ms to
  // coalesce bursts.
  // IMPORTANT: all .on() listeners must be registered BEFORE .subscribe() is
  // called — Supabase ignores listeners added after subscription.
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

    // Resolve merchant members first, then build the channel with ALL listeners
    // before subscribing — this is the only way Supabase Realtime picks them up.
    void supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (cancelled || !user) return;

      // Collect all user IDs to subscribe to (own + merchant members)
      let watchIds: string[] = [user.id];
      try {
        const { data: myProfile } = await supabase
          .from('merchant_profiles')
          .select('merchant_id')
          .eq('user_id', user.id)
          .maybeSingle();
        const mid = (myProfile as { merchant_id?: string } | null)?.merchant_id;
        if (mid) {
          const { data: members } = await supabase
            .from('merchant_profiles')
            .select('user_id')
            .eq('merchant_id', mid);
          const memberIds = (members || [])
            .map((m: { user_id?: string }) => m.user_id)
            .filter((id): id is string => !!id);
          if (memberIds.length > 0) watchIds = Array.from(new Set(memberIds));
        }
      } catch {
        // Non-critical — fall back to own user only
      }

      if (cancelled) return;

      // Build channel with all listeners registered before .subscribe()
      let ch = supabase.channel(`tracker-state-sync-${user.id}`);
      for (const uid of watchIds) {
        ch = ch
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tracker_snapshots', filter: `user_id=eq.${uid}` }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_accounts', filter: `user_id=eq.${uid}` }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_ledger', filter: `user_id=eq.${uid}` }, scheduleRefresh);
      }
      channel = ch.subscribe();
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
    const mountGeneration = getTrackerWriteGeneration();
    loadTrackerStateFromCloud().then((cloudSnapshot) => {
      if (cancelled || mountGeneration !== getTrackerWriteGeneration()) return;
      setCloudLoaded(true);

      if (cloudSnapshot?.cleared) {
        console.info(
          `[boot] cleared tombstone — gen=${cloudSnapshot.writeGeneration} updatedAt=${cloudSnapshot.updatedAt ?? 'n/a'} — booting into empty state`,
        );
        activateTrackerClearBarrier(window.localStorage);
        const empty = buildStateFrom({}, {
          lowStockThreshold: options.lowStockThreshold,
          priceAlertThreshold: options.priceAlertThreshold,
          range: options.range,
          currency: options.currency,
        });
        guardedSetState(empty.state, { expectedGeneration: mountGeneration, allowDuringClear: true });
        return;
      }

      const cloudState = cloudSnapshot?.state ?? null;
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
      console.info(
        `[boot] normal snapshot — batches=${(cloudState as Partial<TrackerState>).batches?.length ?? 0} trades=${(cloudState as Partial<TrackerState>).trades?.length ?? 0} cashAccounts=${(cloudState as Partial<TrackerState>).cashAccounts?.length ?? 0} cashLedger=${(cloudState as Partial<TrackerState>).cashLedger?.length ?? 0}`,
      );
      const inFlight = stateRef.current as Partial<TrackerState>;
      const local = getCurrentTrackerState(window.localStorage) as Partial<TrackerState> | null;
      const localUnion = mergeLocalAndCloud(local, inFlight);
      // Strip cash fields before merging tracker_snapshots — cash is owned by
      // the dedicated cash_accounts / cash_ledger tables loaded below.
      const cloudStateNoCash = {
        ...cloudState,
        cashAccounts: undefined,
        cashLedger: undefined,
        cashHistory: undefined,
        cashQAR: undefined,
      } as Partial<TrackerState>;
      const localUnionNoCash = {
        ...localUnion,
        cashAccounts: undefined,
        cashLedger: undefined,
        cashHistory: undefined,
        cashQAR: undefined,
      } as Partial<TrackerState>;
      const best = mergeLocalAndCloud(localUnionNoCash, cloudStateNoCash);
      if (!best) return;

      const rebuilt = buildStateFrom(best, {
        lowStockThreshold: options.lowStockThreshold,
        priceAlertThreshold: options.priceAlertThreshold,
        range: options.range,
        currency: options.currency,
      });

      guardedSetState(rebuilt.state, { expectedGeneration: mountGeneration });
      // Push merged state back to cloud — preserve cash fields from stateRef
      // since the dedicated cash tables are the source of truth for those.
      const withCash: TrackerState = {
        ...rebuilt.state,
        cashAccounts: stateRef.current.cashAccounts,
        cashLedger: stateRef.current.cashLedger,
        cashQAR: stateRef.current.cashQAR,
      };
      saveTrackerState(withCash);

      // Load dedicated cash tables and merge with local state (prefer cloud, keep local-only entries)
      // ISSUE 6 FIX: previously stateRef.current was never updated after the
      // async setState callback, so any call to applyState() that happened
      // immediately after the cash merge would read stale pre-cash data from
      // stateRef.current and overwrite the cloud cash values when persisting.
      loadCashFromCloud().then(cashData => {
        if (!cashData || mountGeneration !== getTrackerWriteGeneration()) return;
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
        }, { expectedGeneration: mountGeneration });
      }).catch((err) => { console.error('[useTrackerState] cash cloud sync failed:', err); });
    }).catch((err) => {
      console.error('[useTrackerState] cloud load failed:', err);
      setCloudLoaded(true);
    });

    return () => { cancelled = true; };
  }, [adminMode, isAuthenticated, options.preloadedState]);

  return { state, derived, applyState, applyStateAndCommit, cloudLoaded, clearedAccountIds };
}
