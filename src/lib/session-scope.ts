/*
 * Per-user scoping for the device-local tracker caches.
 *
 * Everything the tracker caches in localStorage (tracker state, the write
 * generation counter, tracker_settings with the UI language) is keyed by the
 * storage key alone, not by who is signed in. On a shared device that leaks
 * across accounts in two ways that were both reported in production:
 *
 * - the second user inherits the first user's language and theme, because
 *   tracker_settings is still sitting there when the app boots;
 * - worse, the second user's first autosave does a read-merge-write of the
 *   first user's cached rows and uploads them into their own snapshot.
 *
 * The fix is an ownership stamp. The signed-in user's id is recorded next to
 * the caches; when a different id claims the device, the caches are wiped
 * before anything reads them. Signing out wipes them too, so the next account
 * starts clean even if it signs in from a fresh tab.
 */
import { clearTrackerStorage } from './tracker-backup';

const SCOPE_OWNER_KEY = 'tracker_storage_owner';

function safeStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function getLocalScopeOwner(storage?: Storage): string | null {
  const store = safeStorage(storage);
  if (!store) return null;
  try {
    return store.getItem(SCOPE_OWNER_KEY);
  } catch {
    return null;
  }
}

/**
 * Hand the device-local caches to `userId`, wiping them first if they belong
 * to somebody else. Returns true when a wipe happened, so the caller can also
 * reset any in-memory sync state that mirrors those caches.
 */
export function claimLocalScope(userId: string, storage?: Storage): boolean {
  const store = safeStorage(storage);
  if (!store || !userId) return false;

  const owner = getLocalScopeOwner(store);
  if (owner === userId) return false;

  const wiped = owner !== null;
  if (wiped) clearTrackerStorage(store);

  try {
    store.setItem(SCOPE_OWNER_KEY, userId);
  } catch {
    // best effort
  }
  return wiped;
}

/**
 * Drop the device-local caches on sign-out so the next account cannot read or
 * re-upload the previous one's data.
 */
export function releaseLocalScope(storage?: Storage): void {
  const store = safeStorage(storage);
  if (!store) return;
  clearTrackerStorage(store);
  try {
    store.removeItem(SCOPE_OWNER_KEY);
  } catch {
    // best effort
  }
}
