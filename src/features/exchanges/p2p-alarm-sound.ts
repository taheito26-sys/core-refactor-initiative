/**
 * The merchant's own alarm sound for the P2P order alert, kept on this device
 * only (IndexedDB). Storage can be unavailable (private mode, cleared site
 * data), so every call fails soft and the built-in beep is used instead.
 */
const DB_NAME = 'p2p-alarm-sound';
const STORE = 'sound';
const KEY = 'current';
export const MAX_ALARM_SOUND_BYTES = 5 * 1024 * 1024;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export interface AlarmSound { name: string; blob: Blob }

export const loadAlarmSound = () => run<AlarmSound>('readonly', (s) => s.get(KEY));
export const saveAlarmSound = (sound: AlarmSound) => run('readwrite', (s) => s.put(sound, KEY));
export const clearAlarmSound = () => run('readwrite', (s) => s.delete(KEY));
