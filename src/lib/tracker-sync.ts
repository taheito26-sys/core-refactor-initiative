// Cross-device tracker state & preferences sync via Supabase
import { supabase } from '@/integrations/supabase/client';
import { findTrackerStorageKey } from './tracker-backup';
import {
  hasMeaningfulTrackerData,
  hasTrackerItems,
  clearTrackerClearGuard,
  clearTrackerDataCleared,
  bumpTrackerWriteGeneration,
  isTrackerClearInProgress,
  isTrackerDataCleared,
  getTrackerWriteGeneration,
} from './tracker-backup';
import type { TrackerState } from './tracker-helpers';
import { uploadVaultBackup } from './supabase-vault';
import { clearCashStateFromCloud } from './cash-sync';

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _lastSavedJson = '';
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
  cashAccounts: new Set(),
  cashLedger: new Set(),
  cashHistory: new Set(),
};

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

type TrackerSnapshotRow = {
  state: Partial<TrackerState> | null;
  updated_at?: string | null;
  user_id?: string;
  is_cleared?: boolean | null;
  write_generation?: number | null;
};

export type CloudTrackerSnapshot = {
  state: Partial<TrackerState> | null;
  cleared: boolean;
  writeGeneration: number;
  updatedAt?: string | null;
};

export interface SaveTrackerStateOptions {
  /**
   * When true, write the provided state exactly as-is instead of merging it
   * with the existing cloud snapshot. Use this for destructive operations
   * like clear/import/restore so old data does not get reintroduced.
   */
  replaceExisting?: boolean;
  /**
   * Keep the persistent clear marker so startup hydration continues to skip
   * stale cloud state after a destructive clear.
   */
  preserveDataCleared?: boolean;
  /**
   * Explicitly authorize a clear-state write while the destructive barrier is
   * active. This should only be used for the empty-state payload produced by a
   * clear/reset action.
   */
  allowDuringClear?: boolean;
  /** Internal monotonic token attached to every state write. */
  writeGeneration?: number;
}

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
    .filter(r => r.state && typeof r.state === 'object')
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
      batches: mergeArrayById(merged.batches, Array.isArray(state.batches) ? state.batches : []),
      trades: mergeArrayById(merged.trades, Array.isArray(state.trades) ? state.trades : []),
      customers: mergeArrayById(merged.customers, Array.isArray(state.customers) ? state.customers : []),
      cashAccounts: mergeArrayById(merged.cashAccounts, Array.isArray(state.cashAccounts) ? state.cashAccounts : []),
      cashLedger: mergeArrayById(merged.cashLedger, Array.isArray(state.cashLedger) ? state.cashLedger : []),
      cashHistory: mergeArrayById(merged.cashHistory, Array.isArray(state.cashHistory) ? state.cashHistory : []),
    };
  }
  return merged;
}

/** Save tracker state to localStorage */
function persistToLocal(state: TrackerState, options: { preserveDataCleared?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  try {
    const key = findTrackerStorageKey(window.localStorage);
    window.localStorage.setItem(key, stateToJson(state));
    if (!options.preserveDataCleared) {
      clearTrackerDataCleared(window.localStorage);
    }
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

/** Save tracker state to Supabase (upsert) — debounced */
async function persistToCloud(state: TrackerState, options: SaveTrackerStateOptions = {}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  if (options.writeGeneration !== undefined && options.writeGeneration !== getTrackerWriteGeneration()) {
    return;
  }

  // Strip foreign-origin ids so this user's row only ever contains rows
  // authored (or owned) by this user. Prevents merchant-wide cross-pollution.
  const stripped: TrackerState = {
    ...state,
    batches: stripForeignIds('batches', state.batches),
    trades: stripForeignIds('trades', state.trades),
    customers: stripForeignIds('customers', state.customers),
    suppliers: stripForeignIds('suppliers', state.suppliers),
    cashAccounts: stripForeignIds('cashAccounts', state.cashAccounts),
    cashLedger: stripForeignIds('cashLedger', state.cashLedger),
    cashHistory: stripForeignIds('cashHistory', state.cashHistory),
  };

  let merged: TrackerState = stripped;

  if (!options.replaceExisting) {
    // Read-merge-write: union incoming state with the current cloud row so a
    // fresh device (iOS PWA with empty localStorage, new browser, etc.) cannot
    // wipe data by upserting a partial/empty state. Tracker collections are
    // additive - merging by id is always safe.
    const { data: existingRow } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('tracker_snapshots' as any)
      .select('state')
      .eq('user_id', user.id)
      .maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingState = (existingRow as any)?.state as Partial<TrackerState> | null;

    merged = existingState && typeof existingState === 'object'
      ? {
          ...existingState,
          ...stripped,
          batches: mergeArrayById(existingState.batches, stripped.batches),
          trades: mergeArrayById(existingState.trades, stripped.trades),
          customers: mergeArrayById(existingState.customers, stripped.customers),
          suppliers: mergeArrayById(
            (existingState as Partial<TrackerState>).suppliers,
            stripped.suppliers,
          ),
          cashAccounts: mergeArrayById(existingState.cashAccounts, stripped.cashAccounts),
          cashLedger: mergeArrayById(existingState.cashLedger, stripped.cashLedger),
          cashHistory: mergeArrayById(existingState.cashHistory, stripped.cashHistory),
        } as TrackerState
      : stripped;
  }

  const json = stateToJson(merged);
  if (!json || json === _lastSavedJson) return;
  const isCleared = Boolean(options.allowDuringClear && isExplicitClearPayload(merged));

  const { data, error } = await supabase.rpc('save_tracker_snapshot_if_newer', {
    _user_id: user.id,
    _state: merged,
    _updated_at: new Date().toISOString(),
    _write_generation: options.writeGeneration ?? 0,
    _is_cleared: isCleared,
  });

  if (!error) {
    if (data === false) {
      return;
    }
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
  if (isTrackerDataCleared()) {
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }
    return;
  }
  const writeGeneration = bumpTrackerWriteGeneration();
  const preserveDataCleared = !hasTrackerItems(state);
  persistToLocal(state, { preserveDataCleared });
  clearTrackerClearGuard();

  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    persistToCloud(state, { writeGeneration }).catch((err) => {
      console.warn('[tracker-sync] debounced cloud save failed:', err);
    });
  }, 2000);
}

/** Force an immediate cloud save (e.g. on import/restore) */
export async function saveTrackerStateNow(state: TrackerState, options: SaveTrackerStateOptions = {}): Promise<void> {
  if (_saveTimer) clearTimeout(_saveTimer);
  if (isTrackerDataCleared() && !options.allowDuringClear) {
    return;
  }
  if (options.allowDuringClear && !isExplicitClearPayload(state)) {
    return;
  }
  const writeGeneration = bumpTrackerWriteGeneration();
  const preserveDataCleared = options.preserveDataCleared ?? !hasTrackerItems(state);
  persistToLocal(state, { preserveDataCleared });
  if (options.replaceExisting) {
    await clearCashStateFromCloud().catch((err) => {
      console.warn('[tracker-sync] clearCashStateFromCloud failed:', err);
    });
  } else {
    clearTrackerClearGuard();
  }
  await persistToCloud(state, { ...options, writeGeneration });
}

/** Load tracker state from cloud, returning null if none found */
export async function loadTrackerStateFromCloud(): Promise<CloudTrackerSnapshot | null> {
  if (isTrackerClearInProgress() || isTrackerDataCleared()) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: myMerchantProfile } = await supabase
    .from('merchant_profiles')
    .select('merchant_id')
    .eq('user_id', user.id)
    .maybeSingle();

  let cloudState: Partial<TrackerState> | null = null;
  let cloudWriteGeneration = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merchantId = (myMerchantProfile as any)?.merchant_id as string | undefined;

  if (merchantId) {
    const { data: merchantUsers } = await supabase
      .from('merchant_profiles')
      .select('user_id')
      .eq('merchant_id', merchantId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merchantUserIds = Array.from(new Set((merchantUsers || []).map((m: any) => m.user_id).filter(Boolean)));

    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('tracker_snapshots' as any)
      .select('state, updated_at, user_id, is_cleared, write_generation')
      .in('user_id', merchantUserIds.length ? merchantUserIds : [user.id]);
    if (!error && data) {
      const rows = data as unknown as TrackerSnapshotRow[];
      const clearedRow = rows
        .filter((row) => row.is_cleared)
        .sort((a, b) => {
          const aw = Number(a.write_generation || 0);
          const bw = Number(b.write_generation || 0);
          if (aw !== bw) return bw - aw;
          const at = new Date(a.updated_at || 0).getTime();
          const bt = new Date(b.updated_at || 0).getTime();
          return bt - at;
        })[0];
      if (clearedRow) {
        return {
          state: {},
          cleared: true,
          writeGeneration: Number(clearedRow.write_generation || 0),
          updatedAt: clearedRow.updated_at || null,
        };
      }

      // Reset foreign-id memory, then tag every id that came from OTHER
      // merchant members' rows. These are excluded on save so this user's
      // row never absorbs the merchant-wide merge.
      for (const set of Object.values(_foreignIds)) set.clear();
      for (const row of rows) {
        if (!row.state || row.user_id === user.id) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = row.state as any;
        rememberForeignIds('batches', Array.isArray(s.batches) ? s.batches : []);
        rememberForeignIds('trades', Array.isArray(s.trades) ? s.trades : []);
        rememberForeignIds('customers', Array.isArray(s.customers) ? s.customers : []);
        rememberForeignIds('suppliers', Array.isArray(s.suppliers) ? s.suppliers : []);
        rememberForeignIds('cashAccounts', Array.isArray(s.cashAccounts) ? s.cashAccounts : []);
        rememberForeignIds('cashLedger', Array.isArray(s.cashLedger) ? s.cashLedger : []);
        rememberForeignIds('cashHistory', Array.isArray(s.cashHistory) ? s.cashHistory : []);
      }
      const merged = mergeTrackerStatesForMerchant(rows);
      cloudState = merged as Partial<TrackerState> | null;

      const ownRow = rows.find((r) => r.user_id === user.id);
      if (ownRow) {
        cloudWriteGeneration = Number(ownRow.write_generation || 0);
      }
    }
  } else {
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('tracker_snapshots' as any)
      .select('state, updated_at, is_cleared, write_generation')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!error && data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = data as any;
      if (row.is_cleared) {
        return {
          state: {},
          cleared: true,
          writeGeneration: Number(row.write_generation || 0),
          updatedAt: row.updated_at || null,
        };
      }
      cloudState = row.state as Partial<TrackerState> | null;
      cloudWriteGeneration = Number(row.write_generation || 0);
    }
  }

  if (!cloudState || typeof cloudState !== 'object') return null;

  // Validate it looks like tracker state
  if (!hasMeaningfulTrackerData(cloudState)) {
    return null;
  }

  return {
    state: cloudState,
    cleared: false,
    writeGeneration: cloudWriteGeneration,
  };
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
