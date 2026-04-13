// Cross-device tracker state & preferences sync via Supabase
import { supabase } from '@/integrations/supabase/client';
import { findTrackerStorageKey } from './tracker-backup';
import type { TrackerState } from './tracker-helpers';

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _lastSavedJson = '';
let _prefTimer: ReturnType<typeof setTimeout> | null = null;
let _lastSavedPrefs = '';

function stateToJson(state: TrackerState): string {
  try {
    return JSON.stringify(state);
  } catch {
    return '';
  }
}

/** Save tracker state to localStorage */
function persistToLocal(state: TrackerState): void {
  if (typeof window === 'undefined') return;
  try {
    const key = findTrackerStorageKey(window.localStorage);
    window.localStorage.setItem(key, stateToJson(state));
    window.localStorage.removeItem('tracker_data_cleared');
  } catch {
    // quota exceeded — silent
  }
}

/** Upsert row ensuring user_id row exists */
async function ensureRow(userId: string): Promise<void> {
  await supabase
    .from('tracker_snapshots' as any)
    .upsert(
      { user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id', ignoreDuplicates: true }
    );
}

/** Save tracker state to Supabase (upsert) — debounced */
async function persistToCloud(state: TrackerState): Promise<void> {
  const json = stateToJson(state);
  if (!json || json === _lastSavedJson) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from('tracker_snapshots' as any)
    .upsert(
      { user_id: user.id, state: state as any, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

  if (!error) {
    _lastSavedJson = json;
  } else {
    console.warn('[tracker-sync] cloud save failed:', error.message);
  }
}

/** Persist state to localStorage immediately and to cloud (debounced 2s) */
export function saveTrackerState(state: TrackerState): void {
  persistToLocal(state);

  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    void persistToCloud(state);
  }, 2000);
}

/** Force an immediate cloud save (e.g. on import/restore) */
export async function saveTrackerStateNow(state: TrackerState): Promise<void> {
  if (_saveTimer) clearTimeout(_saveTimer);
  persistToLocal(state);
  await persistToCloud(state);
}

/** Load tracker state from cloud, returning null if none found */
export async function loadTrackerStateFromCloud(): Promise<Partial<TrackerState> | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('tracker_snapshots' as any)
    .select('state, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data) return null;

  const cloudState = (data as any).state as Partial<TrackerState> | null;
  if (!cloudState || typeof cloudState !== 'object') return null;

  // Validate it looks like tracker state
  if (!Array.isArray(cloudState.batches) && !Array.isArray(cloudState.trades) && !Array.isArray(cloudState.customers)) {
    return null;
  }

  return cloudState;
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
    .from('tracker_snapshots' as any)
    .upsert(
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
    .from('tracker_snapshots' as any)
    .select('preferences')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data) return null;

  const prefs = (data as any).preferences as Record<string, unknown> | null;
  if (!prefs || typeof prefs !== 'object' || Object.keys(prefs).length === 0) return null;

  return prefs;
}
