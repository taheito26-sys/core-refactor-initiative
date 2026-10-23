// Cross-device tracker state & preferences sync via Supabase
import { supabase } from '@/integrations/supabase/client';
import { findTrackerStorageKey, getTrackerWriteGeneration, isTrackerDataCleared, isTrackerClearInProgress,
  syncTrackerWriteGenerationToAtLeast, bumpTrackerWriteGeneration, liftTrackerClearBarrier, clearTrackerClearGuard } from './tracker-backup';
import { clearCashStateFromCloud, saveCashToCloud, resetCashSyncSession } from './cash-sync';
import { hasMeaningfulTrackerData } from './tracker-backup';
import { mergeLoansByRecency, mergeBatchesByRecency, withoutDeletedRepayments, type TrackerState } from './tracker-helpers';
import { mergeTransfersByRecency } from './usdt-transfers';
import { uploadVaultBackup } from './supabase-vault';

let _sessionEpoch = 0;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _lastSavedJson = '';
/**
 * Once we've successfully read the cloud row at least once this session,
 * the in-memory tracker state has incorporated everything cloud knew about,
 * so persistToCloud can safely OVERWRITE the row. Before this flag flips,
 * we still do read-merge-write so a fresh PWA with empty localStorage can't
 * wipe the cloud by upserting an empty state.
 *
 * This is what makes deletes (batch removed, trade removed) propagate —
 * without it, the read-merge-write union-by-id keeps resurrecting deleted
 * items every time we save.
 */
let _cloudLoadedThisSession = false;
let _prefTimer: ReturnType<typeof setTimeout> | null = null;
let _lastSavedPrefs = '';
let _lastAutoBackupTs = Date.now(); // Start from now so first backup waits 30 min
let _lastAutoBackupHash = '';
const AUTO_BACKUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Ids that came from OTHER merchant members' tracker_snapshots on the most
 * recent load. Excluded on save so this user's row never absorbs another
 * user's data — prevents the merchant-wide read/write pollution cycle.
 */
const _foreignIds: Record<string, Set<string>> = {
  batches: new Set(),
  trades: new Set(),
  customers: new Set(),
  suppliers: new Set(),
  usdtTransfers: new Set(),
  cashAccounts: new Set(),
  cashLedger: new Set(),
  cashHistory: new Set(),
};

/**
 * Forget everything this module cached about the session that just ended.
 * Called when the signed-in user changes so the next account does not inherit
 * the previous one's cloud-loaded flag, foreign-id sets or dedupe hashes —
 * each of which would otherwise let one user's rows reach another's snapshot.
 */
export function resetTrackerSyncSession(): void {
  _sessionEpoch += 1;
  resetCashSyncSession();
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = null;
  if (_prefTimer) clearTimeout(_prefTimer);
  _prefTimer = null;
  _lastSavedJson = '';
  _lastSavedPrefs = '';
  _cloudLoadedThisSession = false;
  _lastAutoBackupTs = Date.now();
  _lastAutoBackupHash = '';
  for (const key of Object.keys(_foreignIds) as (keyof typeof _foreignIds)[]) {
    _foreignIds[key].clear();
  }
}

function rememberForeignIds(
  collectionKey: keyof typeof _foreignIds,
  rows: unknown[],
): void {
  const set = _foreignIds[collectionKey];
  for (const r of rows) {
    if (r && typeof r === 'object' && 'id' in (r as Record<string, unknown>)) {
      set.add(String((r as Record<string, unknown>).id));
    }
  }
}

function stripForeignIds<T extends { id?: string } | Record<string, unknown>>(
  collectionKey: keyof typeof _foreignIds,
  rows: T[] | undefined,
): T[] {
  const set = _foreignIds[collectionKey];
  if (!Array.isArray(rows) || set.size === 0) return rows ?? [];
  return rows.filter((r) => {
    const id = (r as { id?: unknown })?.id;
    return typeof id !== 'string' || !set.has(id);
  });
}

/**
 * Circuit breaker for every deletedXIds tombstone list (customers, batches,
 * trades, loans, repayments): a save that suddenly wants to tombstone a
 * large slice of a collection in one shot is far more likely to be a bug
 * than a real bulk delete — the actual UI actions that tombstone anything
 * (fold a duplicate customer, delete one batch/trade/loan/repayment) only
 * ever touch one id at a time. This does not stop a customer's data from
 * ever being lost outright (a union can't do that on its own — see the
 * customers merge above), but it is a second, independent line of defense
 * against a *different* future bug that manages to push many ids into a
 * tombstone list at once: rather than silently applying it, that save's
 * new tombstones for this collection are dropped (the ids stay), and it's
 * logged loudly so the failure is visible instead of quietly destructive.
 * `latestCount` is the cloud row's current collection size, so a big
 * tombstone list against a small collection (e.g. genuinely clearing out
 * 4 of 5 batches) isn't penalized — only an outsized jump is.
 */
export function guardTombstones(
  collectionName: string,
  latestIds: string[] | undefined,
  incomingIds: string[] | undefined,
  latestCount: number,
): string[] {
  const latest = latestIds || [];
  const incoming = incomingIds || [];
  const newlyTombstoned = incoming.filter(id => !latest.includes(id));
  const MAX_NEW_ABSOLUTE = 5;
  const MAX_NEW_FRACTION = 0.2;
  if (
    newlyTombstoned.length > MAX_NEW_ABSOLUTE &&
    newlyTombstoned.length > latestCount * MAX_NEW_FRACTION
  ) {
    console.error(
      `[tracker-sync] Refusing ${newlyTombstoned.length} new ${collectionName} tombstone(s) in one save ` +
      `(cloud currently has ${latestCount}) — this looks like a bug, not a real bulk delete. ` +
      `Keeping the existing ${collectionName} tombstone list unchanged this save; if this is genuinely a ` +
      `deliberate bulk delete, it will need to be applied in smaller batches or via an explicit admin patch.`,
    );
    return latest.slice(-500);
  }
  return Array.from(new Set([...latest, ...incoming])).slice(-500);
}

function quickHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function stateToJson(state: TrackerState): string {
  try {
    return JSON.stringify(state);
  } catch {
    return '';
  }
}

type TrackerSnapshotRow = {
  state: Partial<TrackerState> | null;
  updated_at?: string | null;
  user_id?: string;
  write_generation?: number;
  is_cleared?: boolean;
};

function mergeArrayById<T>(base: T[] | undefined, incoming: T[] | undefined): T[] {
  const out = new Map<string, T>();
  for (const item of base || []) {
    const key = typeof item === 'object' && item && 'id' in (item as Record<string, unknown>)
      ? String((item as Record<string, unknown>).id)
      : JSON.stringify(item);
    out.set(key, item);
  }
  for (const item of incoming || []) {
    const key = typeof item === 'object' && item && 'id' in (item as Record<string, unknown>)
      ? String((item as Record<string, unknown>).id)
      : JSON.stringify(item);
    out.set(key, item);
  }
  return Array.from(out.values());
}

/** Merge multiple snapshot states into one merchant-scoped view. */
export function mergeTrackerStatesForMerchant(rows: TrackerSnapshotRow[]): Partial<TrackerState> | null {
  const validRows = rows
    .filter(r => !r.is_cleared && r.state && typeof r.state === 'object')
    .sort((a, b) => {
      const at = new Date(a.updated_at || 0).getTime();
      const bt = new Date(b.updated_at || 0).getTime();
      return at - bt;
    });

  if (validRows.length === 0) return null;

  let merged: Partial<TrackerState> = {};
  for (const row of validRows) {
    const state = row.state!;
    merged = {
      ...merged,
      ...state,
      batches: mergeBatchesByRecency(merged.batches, Array.isArray(state.batches) ? state.batches : []),
      trades: mergeArrayById(merged.trades, Array.isArray(state.trades) ? state.trades : []),
      customers: mergeArrayById(merged.customers, Array.isArray(state.customers) ? state.customers : []),
      cashAccounts: mergeArrayById(merged.cashAccounts, Array.isArray(state.cashAccounts) ? state.cashAccounts : []),
      cashLedger: mergeArrayById(merged.cashLedger, Array.isArray(state.cashLedger) ? state.cashLedger : []),
      cashHistory: mergeArrayById(merged.cashHistory, Array.isArray(state.cashHistory) ? state.cashHistory : []),
      customerLoans: mergeLoansByRecency(merged.customerLoans, Array.isArray(state.customerLoans) ? state.customerLoans : []),
      usdtTransfers: mergeTransfersByRecency(merged.usdtTransfers, Array.isArray(state.usdtTransfers) ? state.usdtTransfers : []),
      // Union tombstones across every member's row too — a delete recorded
      // by any team member must stick for everyone, not just the deleter.
      deletedLoanIds: Array.from(new Set([
        ...(merged.deletedLoanIds || []),
        ...(Array.isArray(state.deletedLoanIds) ? state.deletedLoanIds : []),
      ])).slice(-500),
      deletedBatchIds: Array.from(new Set([
        ...(merged.deletedBatchIds || []),
        ...(Array.isArray(state.deletedBatchIds) ? state.deletedBatchIds : []),
      ])).slice(-500),
      deletedTradeIds: Array.from(new Set([
        ...(merged.deletedTradeIds || []),
        ...(Array.isArray(state.deletedTradeIds) ? state.deletedTradeIds : []),
      ])).slice(-500),
      deletedRepaymentIds: Array.from(new Set([
        ...(merged.deletedRepaymentIds || []),
        ...(Array.isArray(state.deletedRepaymentIds) ? state.deletedRepaymentIds : []),
      ])).slice(-500),
      deletedCustomerIds: Array.from(new Set([
        ...(merged.deletedCustomerIds || []),
        ...(Array.isArray(state.deletedCustomerIds) ? state.deletedCustomerIds : []),
      ])).slice(-500),
    };
  }
  if (merged.customers && merged.deletedCustomerIds?.length) {
    const deleted = new Set(merged.deletedCustomerIds);
    merged.customers = merged.customers.filter(c => !deleted.has(c.id));
  }
  if (merged.customerLoans && merged.deletedLoanIds?.length) {
    const deleted = new Set(merged.deletedLoanIds);
    merged.customerLoans = merged.customerLoans.filter(l => !deleted.has(l.id));
  }
  if (merged.customerLoans && merged.deletedRepaymentIds?.length) {
    merged.customerLoans = withoutDeletedRepayments(merged.customerLoans, merged.deletedRepaymentIds);
  }
  if (merged.batches && merged.deletedBatchIds?.length) {
    const deleted = new Set(merged.deletedBatchIds);
    merged.batches = merged.batches.filter(b => !deleted.has(b.id));
  }
  if (merged.trades && merged.deletedTradeIds?.length) {
    const deleted = new Set(merged.deletedTradeIds);
    merged.trades = merged.trades.filter(tr => !deleted.has(tr.id));
  }
  return merged;
}

/** Save tracker state to localStorage */
function persistToLocal(state: TrackerState): void {
  if (typeof window === 'undefined') return;
  try {
    const key = findTrackerStorageKey(window.localStorage);
    window.localStorage.setItem(key, stateToJson(state));
  } catch {
    // quota exceeded — silent
  }
}

/** Upsert row ensuring user_id row exists */
async function ensureRow(userId: string): Promise<void> {
  await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('tracker_snapshots' as any)
    .upsert(
      { user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id', ignoreDuplicates: true }
    );
}

export interface TrackerSaveOptions {
  replaceExisting?: boolean;
  preserveDataCleared?: boolean;
  allowDuringClear?: boolean;
}

function writesBlocked(): boolean {
  return isTrackerDataCleared() || isTrackerClearInProgress();
}

function isEmptyClearState(state: TrackerState): boolean {
  const data = state as unknown as Record<string, unknown>;
  return ['batches', 'trades', 'customers', 'suppliers', 'cashAccounts', 'cashLedger', 'cashHistory']
    .every(key => Array.isArray(data[key]) && data[key].length === 0)
    && ['customerLoans', 'usdtTransfers'].every(key => data[key] == null || (Array.isArray(data[key]) && data[key].length === 0))
    && state.cashQAR === 0 && !state.cashOwner;
}

/** Save through the database generation fence; never fall back to a direct state upsert. */
async function persistToCloud(state: TrackerState, options: TrackerSaveOptions = {}, generation = getTrackerWriteGeneration()): Promise<void> {
  const epoch = _sessionEpoch;
  const assertCurrent = () => {
    if (epoch !== _sessionEpoch || generation !== getTrackerWriteGeneration() || (writesBlocked() && !options.allowDuringClear)) {
      throw new Error('Tracker write cancelled by a clear or session change. Reload before saving.');
    }
  };
  assertCurrent();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Sign in before saving tracker data.');
  assertCurrent();

  // Strip foreign-origin ids so this user's row only ever contains rows
  // authored (or owned) by this user. Prevents merchant-wide cross-pollution.
  // Cash is intentionally NOT written to the snapshot — the dedicated
  // cash_accounts / cash_ledger tables are the single source of truth for
  // cash, otherwise a stale snapshot resurrects cleared cash on next load.
  const stripped: TrackerState = {
    ...state,
    batches: stripForeignIds('batches', state.batches),
    trades: stripForeignIds('trades', state.trades),
    customers: stripForeignIds('customers', state.customers),
    suppliers: stripForeignIds('suppliers', state.suppliers),
    usdtTransfers: stripForeignIds('usdtTransfers', state.usdtTransfers),
    cashAccounts: [],
    cashLedger: [],
    cashHistory: [],
  };

  // We ALWAYS fetch the latest cloud row fresh, right before writing, and
  // never blindly upload this device's in-memory copy over it — that is what
  // stops a device whose local state is momentarily behind (a slow initial
  // cloud load, a missed realtime event, a dropped connection) from wiping
  // out data another device already wrote. Before the first cloud load this
  // session, we read-merge-write everything so a fresh device (iOS PWA with
  // empty localStorage) can't wipe cloud by upserting empty.
  //
  // Trades, batches, and loans are always merged (never overwritten), even
  // after the first cloud load, because an idle tab/device whose in-memory
  // state predates something added elsewhere would otherwise blow it away
  // the next time it saves anything at all — its "overwrite once loaded"
  // save simply never knew the row existed.
  //
  // The normal UI delete path for a trade only ever sets voided:true and
  // leaves the record in place (see deleteTrade) — but mergeArrayById lets
  // the incoming (often stale) copy win over cloud for any id present in
  // both, so a trade that WAS truly removed from the array (an out-of-band
  // correction, not the normal UI path) needs the same tombstone treatment
  // batches and loans already have, or a stale device's save silently
  // resurrects it. See TrackerState.deletedTradeIds/deletedBatchIds/deletedLoanIds
  // for the identical pattern applied three times.
  let merged: TrackerState = stripped;
  const { data: latestRow, error: readError } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('tracker_snapshots' as any)
    .select('state, write_generation, is_cleared')
    .eq('user_id', user.id)
    .maybeSingle();
  if (readError) throw new Error(`Tracker read failed: ${readError.message}`);
  assertCurrent();
  const serverGeneration = Number((latestRow as unknown as TrackerSnapshotRow | null)?.write_generation ?? 0);
  if (options.replaceExisting) {
    syncTrackerWriteGenerationToAtLeast(serverGeneration);
    generation = bumpTrackerWriteGeneration();
  } else if (serverGeneration > generation) {
    throw new Error('Tracker changed on another device. Reload before saving.');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestState = (latestRow as any)?.state as Partial<TrackerState> | null;

  if (!options.replaceExisting && latestState && typeof latestState === 'object') {
    const deletedLoanIds = guardTombstones(
      'customerLoans', latestState.deletedLoanIds, stripped.deletedLoanIds, (latestState.customerLoans || []).length,
    );
    const latestRepaymentCount = (latestState.customerLoans || [])
      .reduce((sum, l) => sum + (l.repayments || []).length, 0);
    const deletedRepaymentIds = guardTombstones(
      'repayments', latestState.deletedRepaymentIds, stripped.deletedRepaymentIds, latestRepaymentCount,
    );
    const mergedLoans = withoutDeletedRepayments(
      mergeLoansByRecency(latestState.customerLoans, stripped.customerLoans)
        .filter(l => !deletedLoanIds.includes(l.id)),
      deletedRepaymentIds,
    );

    const deletedBatchIds = guardTombstones(
      'batches', latestState.deletedBatchIds, stripped.deletedBatchIds, (latestState.batches || []).length,
    );
    const mergedBatches = mergeArrayById(latestState.batches, stripped.batches)
      .filter(b => !deletedBatchIds.includes((b as { id: string }).id));

    const deletedTradeIds = guardTombstones(
      'trades', latestState.deletedTradeIds, stripped.deletedTradeIds, (latestState.trades || []).length,
    );
    const mergedTrades = mergeArrayById(latestState.trades, stripped.trades)
      .filter(tr => !deletedTradeIds.includes((tr as { id: string }).id));

    // customers/suppliers are unioned by id on every save, exactly like
    // trades/batches/loans above — NOT only before the first cloud load of
    // the session. The previous code only merged them pre-load and then
    // wholesale-overwrote the cloud row with this device's own in-memory
    // copy on every save after that; if `_cloudLoadedThisSession` flipped
    // true (trades/batches/loans loaded fine) while `state.customers`
    // itself was still incomplete in memory for any reason — a slow or
    // partial reload right after a sign-out/sign-in cycle being the
    // observed case — the very next save would silently replace the
    // cloud's full customer list with that incomplete local one, deleting
    // every customer the device didn't currently know about. See
    // deletedCustomerIds for why a plain union still needs its own
    // tombstone list, same as batches/trades/loans.
    const deletedCustomerIds = guardTombstones(
      'customers', latestState.deletedCustomerIds, stripped.deletedCustomerIds, (latestState.customers || []).length,
    );
    const mergedCustomers = mergeArrayById(latestState.customers, stripped.customers)
      .filter(c => !deletedCustomerIds.includes((c as { id: string }).id));

    merged = {
      ...merged,
      trades: mergedTrades,
      deletedTradeIds,
      customerLoans: mergedLoans,
      deletedLoanIds,
      deletedRepaymentIds,
      batches: mergedBatches,
      deletedBatchIds,
      customers: mergedCustomers,
      deletedCustomerIds,
      suppliers: mergeArrayById(latestState.suppliers, stripped.suppliers),
      // Borrow/lend transfers are voided, never removed, so a recency merge
      // (latest updatedAt wins) is all that keeps a stale device from
      // undoing a newer edit or void.
      usdtTransfers: mergeTransfersByRecency(latestState.usdtTransfers, stripped.usdtTransfers),
    };

    if (!_cloudLoadedThisSession) {
      merged = {
        ...latestState,
        ...merged,
        cashAccounts: [],
        cashLedger: [],
        cashHistory: [],
      } as TrackerState;
    }
  }

  const json = stateToJson(merged);
  if (!json || (!options.replaceExisting && json === _lastSavedJson)) return;

  assertCurrent();
  const { data: accepted, error } = await supabase.rpc('save_tracker_snapshot_if_newer', {
    _user_id: user.id,
    _state: merged as unknown as import('@/integrations/supabase/types').Json,
    _updated_at: new Date().toISOString(),
    _write_generation: generation,
    _is_cleared: !!options.preserveDataCleared,
  });
  if (!error && accepted !== true) throw new Error('Tracker changed on another device. Reload before saving.');
  assertCurrent();
  if (!error && options.preserveDataCleared) await clearCashStateFromCloud(user.id);
  else if (!error && options.replaceExisting) {
    await saveCashToCloud(state.cashAccounts ?? [], state.cashLedger ?? [], true, user.id);
  }
  assertCurrent();

  if (!error) {
    _lastSavedJson = json;

    // Auto-backup to vault storage — only when data actually changed AND throttled to 30 min
    const stateHash = quickHash(json);
    const now = Date.now();
    if (
      stateHash !== _lastAutoBackupHash &&
      now - _lastAutoBackupTs >= AUTO_BACKUP_INTERVAL_MS
    ) {
      _lastAutoBackupTs = now;
      _lastAutoBackupHash = stateHash;

      // Build descriptive label
      const collections = state as unknown as Record<string, unknown>;
      const counts: string[] = [];
      for (const key of ['trades', 'batches', 'customers', 'cashAccounts', 'cashLedger'] as const) {
        const arr = Array.isArray(collections[key]) ? (collections[key] as unknown[]) : [];
        if (arr.length > 0) counts.push(`${arr.length} ${key}`);
      }
      const label = `Auto · ${counts.join(', ') || 'state sync'}`;

      void uploadVaultBackup(user.id, state as unknown as Record<string, unknown>, label).catch(() => {
        // Non-critical — don't block the main save
      });
    }
  } else {
    console.warn('[tracker-sync] cloud save failed:', error.message);
    // Throw so callers that await (saveTrackerStateNow → applyStateAndCommit)
    // can propagate the failure and abort their success toast. The debounced
    // path swallows this in its own wrapper.
    throw new Error(error.message);
  }
}

/** Persist state to localStorage immediately and to cloud (debounced 2s) */
export function saveTrackerState(state: TrackerState): void {
  if (writesBlocked()) return;
  const generation = getTrackerWriteGeneration();
  persistToLocal(state);

  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    persistToCloud(state, {}, generation).catch((err) => {
      console.warn('[tracker-sync] debounced cloud save failed:', err);
    });
  }, 2000);
}

/** Force an immediate cloud save (e.g. on import/restore) */
export async function saveTrackerStateNow(state: TrackerState, options: TrackerSaveOptions = {}): Promise<void> {
  const epoch = _sessionEpoch;
  if (options.preserveDataCleared && (!options.replaceExisting || !options.allowDuringClear || !isEmptyClearState(state))) {
    throw new Error('A full clear requires a complete empty tracker state.');
  }
  if (_saveTimer) clearTimeout(_saveTimer);
  await persistToCloud(state, options);
  if (epoch !== _sessionEpoch) throw new Error('Account changed during tracker save.');
  persistToLocal(state);
  if (options.allowDuringClear && !options.preserveDataCleared) {
    liftTrackerClearBarrier();
    clearTrackerClearGuard();
  }
}

/** Load tracker state from cloud, returning null if none found */
export interface TrackerCloudSnapshot {
  state: Partial<TrackerState>;
  cleared: boolean;
}

export async function loadTrackerStateFromCloud(): Promise<TrackerCloudSnapshot | null> {
  const epoch = _sessionEpoch;
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user || epoch !== _sessionEpoch) return null;
  let ownRow: TrackerSnapshotRow | undefined;
  const { data: myMerchantProfile, error: profileError } = await supabase
    .from('merchant_profiles')
    .select('merchant_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (epoch !== _sessionEpoch) return null;
  let cloudState: Partial<TrackerState> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merchantId = (myMerchantProfile as any)?.merchant_id as string | undefined;

  if (merchantId) {
    const { data: merchantUsers, error: membersError } = await supabase
      .from('merchant_profiles')
      .select('user_id')
      .eq('merchant_id', merchantId);
    if (membersError) throw new Error(membersError.message);
    if (epoch !== _sessionEpoch) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merchantUserIds = Array.from(new Set((merchantUsers || []).map((m: any) => m.user_id).filter(Boolean)));

    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('tracker_snapshots' as any)
      .select('state, updated_at, user_id, write_generation, is_cleared')
      .in('user_id', merchantUserIds.length ? merchantUserIds : [user.id]);
    if (error) throw new Error(error.message);
    if (epoch !== _sessionEpoch) return null;
    if (data) {
      // Reset foreign-id memory, then tag every id that came from OTHER
      // merchant members' rows. These are excluded on save so this user's
      // row never absorbs the merchant-wide merge.
      for (const set of Object.values(_foreignIds)) set.clear();
      const rows = data as unknown as TrackerSnapshotRow[];
      ownRow = rows.find(row => row.user_id === user.id);
      for (const row of rows) {
        if (row.is_cleared || !row.state || row.user_id === user.id) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = row.state as any;
        rememberForeignIds('batches', Array.isArray(s.batches) ? s.batches : []);
        rememberForeignIds('trades', Array.isArray(s.trades) ? s.trades : []);
        rememberForeignIds('customers', Array.isArray(s.customers) ? s.customers : []);
        rememberForeignIds('suppliers', Array.isArray(s.suppliers) ? s.suppliers : []);
        rememberForeignIds('usdtTransfers', Array.isArray(s.usdtTransfers) ? s.usdtTransfers : []);
        rememberForeignIds('cashAccounts', Array.isArray(s.cashAccounts) ? s.cashAccounts : []);
        rememberForeignIds('cashLedger', Array.isArray(s.cashLedger) ? s.cashLedger : []);
        rememberForeignIds('cashHistory', Array.isArray(s.cashHistory) ? s.cashHistory : []);
      }
      cloudState = mergeTrackerStatesForMerchant(rows);
      if (!cloudState && ownRow?.is_cleared) cloudState = {};
    }
  } else {
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('tracker_snapshots' as any)
      .select('state, updated_at, write_generation, is_cleared')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (epoch !== _sessionEpoch) return null;
    if (data) {
      ownRow = data as unknown as TrackerSnapshotRow;
      cloudState = ownRow.is_cleared ? {} : ownRow.state;
    }
  }

  if (epoch !== _sessionEpoch) return null;
  if (ownRow) syncTrackerWriteGenerationToAtLeast(Number(ownRow.write_generation ?? 0));
  if (!cloudState || typeof cloudState !== 'object') return null;

  // Validate it looks like tracker state
  if (!ownRow?.is_cleared && !hasMeaningfulTrackerData(cloudState)) {
    return null;
  }

  _cloudLoadedThisSession = true;
  return { state: cloudState, cleared: !!ownRow?.is_cleared && !hasMeaningfulTrackerData(cloudState) };
}

// ── Preferences sync ──

/** Save user preferences to cloud (debounced 1.5s) */
export function savePreferencesToCloud(prefs: Record<string, unknown>): void {
  if (_prefTimer) clearTimeout(_prefTimer);
  _prefTimer = setTimeout(() => {
    void persistPrefsToCloud(prefs);
  }, 1500);
}

/** Force immediate preference save */
export async function savePreferencesNow(prefs: Record<string, unknown>): Promise<void> {
  if (_prefTimer) clearTimeout(_prefTimer);
  await persistPrefsToCloud(prefs);
}

async function persistPrefsToCloud(prefs: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify(prefs);
  if (json === _lastSavedPrefs) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('tracker_snapshots' as any)
    .upsert(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { user_id: user.id, preferences: prefs as any, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

  if (!error) {
    _lastSavedPrefs = json;
  } else {
    console.warn('[tracker-sync] preferences save failed:', error.message);
  }
}

/** Load preferences from cloud */
export async function loadPreferencesFromCloud(): Promise<Record<string, unknown> | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('tracker_snapshots' as any)
    .select('preferences')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prefs = (data as any).preferences as Record<string, unknown> | null;
  if (!prefs || typeof prefs !== 'object' || Object.keys(prefs).length === 0) return null;

  return prefs;
}
