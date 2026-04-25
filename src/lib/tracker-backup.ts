const TRACKER_STATE_KEYS = [
  'tracker_state',
  'p2p_tracker_state',
  'p2p_tracker',
  'taheito_tracker_state',
  'taheito_state',
] as const;

const TRACKER_STATE_PREFIXES = ['taheito', 'p2p_tracker'] as const;

const TRACKER_CLEAR_EXACT_KEYS = [
  'tracker_state',
  'tracker_settings',
  'tracker_logs',
  'p2p_tracker_state',
  'p2p_tracker',
  'taheito_tracker_state',
  'taheito_state',
  'p2p_tracker_vault_meta',
] as const;

const IMPORT_STATE_CANDIDATE_KEYS = [
  'state',
  'trackerState',
  'tracker_state',
  'data',
  'payload',
  'appState',
  'backup',
  'snapshot',
  'content',
] as const;

export const AUTO_BACKUP_KEYS = ['gasAutoSave', 'trackerAutoBackup', 'taheitoAutoBackup'] as const;
const TRACKER_CLEAR_GUARD_KEY = 'tracker_clear_guard_ts';
const TRACKER_DATA_CLEARED_KEY = 'tracker_data_cleared';
const TRACKER_CLEAR_GUARD_TTL_MS = 15_000;

export type TrackerState = Record<string, unknown>;

const TRACKER_DATA_KEYS = [
  'batches',
  'trades',
  'customers',
  'suppliers',
  'cashAccounts',
  'cashLedger',
  'cashHistory',
] as const;

function storageKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key) keys.push(key);
  }
  return keys;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function hasMeaningfulTrackerData(value: unknown): value is TrackerState {
  if (!isObject(value)) return false;
  return TRACKER_DATA_KEYS.some((key) => Array.isArray(value[key]));
}

function looksLikeTrackerState(value: unknown): value is TrackerState {
  return hasMeaningfulTrackerData(value);
}

function extractFromSnapshots(value: Record<string, unknown>): TrackerState | null {
  if (Array.isArray(value.snapshots)) {
    for (const snap of value.snapshots) {
      if (isObject(snap) && looksLikeTrackerState(snap.state)) {
        return snap.state;
      }
    }
  }
  if (Array.isArray(value.versions)) {
    for (const version of value.versions) {
      if (isObject(version) && looksLikeTrackerState(version.state)) return version.state;
      if (isObject(version) && isObject(version.content) && looksLikeTrackerState(version.content.state)) return version.content.state;
    }
  }
  return null;
}

export function normalizeImportedTrackerState(raw: unknown): TrackerState {
  if (looksLikeTrackerState(raw)) return raw;
  if (!isObject(raw)) throw new Error('Invalid backup format');

  const fromSnapshots = extractFromSnapshots(raw);
  if (fromSnapshots) return fromSnapshots;

  for (const key of IMPORT_STATE_CANDIDATE_KEYS) {
    const candidate = raw[key];
    if (looksLikeTrackerState(candidate)) return candidate;
    if (isObject(candidate)) {
      for (const nestedKey of IMPORT_STATE_CANDIDATE_KEYS) {
        const nested = candidate[nestedKey];
        if (looksLikeTrackerState(nested)) return nested;
      }
    }
  }

  throw new Error('Invalid backup format');
}

export function findTrackerStorageKey(storage: Storage): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = storageKeys(storage).find((k) => TRACKER_STATE_PREFIXES.some((prefix) => k.startsWith(prefix)) || TRACKER_STATE_KEYS.includes(k as any));
  return existing || TRACKER_STATE_KEYS[0];
}

export function getCurrentTrackerState(storage: Storage): TrackerState {
  try {
    const key = findTrackerStorageKey(storage);
    const value = storage.getItem(key);
    if (!value) return {};
    return normalizeImportedTrackerState(JSON.parse(value));
  } catch {
    return {};
  }
}

export function loadAutoBackupFromStorage(storage: Storage): boolean {
  for (const key of AUTO_BACKUP_KEYS) {
    const value = storage.getItem(key);
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return true;
}

export function saveAutoBackupToStorage(storage: Storage, value: boolean): void {
  for (const key of AUTO_BACKUP_KEYS) storage.setItem(key, String(value));
}

export function listTrackerKeysToClear(storage: Storage): string[] {
  const keys = new Set<string>([
    ...TRACKER_CLEAR_EXACT_KEYS,
    ...AUTO_BACKUP_KEYS,
  ]);

  for (const key of storageKeys(storage)) {
    if (TRACKER_STATE_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.add(key);
    if (key.startsWith('tracker_')) keys.add(key);
  }

  return Array.from(keys);
}

export function clearTrackerStorage(storage: Storage): void {
  for (const key of listTrackerKeysToClear(storage)) {
    storage.removeItem(key);
  }
}

export function markTrackerDataCleared(storage: Storage = localStorage): void {
  try {
    storage.setItem(TRACKER_DATA_CLEARED_KEY, 'true');
  } catch {
    // best effort
  }
}

export function isTrackerDataCleared(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(TRACKER_DATA_CLEARED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function clearTrackerDataCleared(storage: Storage = localStorage): void {
  try {
    storage.removeItem(TRACKER_DATA_CLEARED_KEY);
  } catch {
    // best effort
  }
}

export function markTrackerClearInProgress(storage: Storage = sessionStorage): void {
  try {
    storage.setItem(TRACKER_CLEAR_GUARD_KEY, String(Date.now()));
  } catch {
    // best effort
  }
}

export function isTrackerClearInProgress(storage: Storage = sessionStorage): boolean {
  try {
    const raw = storage.getItem(TRACKER_CLEAR_GUARD_KEY);
    const ts = raw ? Number(raw) : 0;
    if (!Number.isFinite(ts) || ts <= 0) return false;
    if (Date.now() - ts > TRACKER_CLEAR_GUARD_TTL_MS) {
      storage.removeItem(TRACKER_CLEAR_GUARD_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function clearTrackerClearGuard(storage: Storage = sessionStorage): void {
  try {
    storage.removeItem(TRACKER_CLEAR_GUARD_KEY);
  } catch {
    // best effort
  }
}
