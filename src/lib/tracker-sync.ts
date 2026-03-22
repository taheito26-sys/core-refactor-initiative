// Cross-device tracker state sync via Supabase
import { supabase } from '@/integrations/supabase/client';
import { findTrackerStorageKey } from './tracker-backup';
import type { TrackerState } from './tracker-helpers';

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _lastSavedJson = '';

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
