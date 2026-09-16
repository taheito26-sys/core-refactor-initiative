import { describe, it, expect, beforeEach } from 'vitest';
import { claimLocalScope, releaseLocalScope, getLocalScopeOwner } from '@/lib/session-scope';

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  } as Storage;
}

describe('session scope', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = makeStorage();
    storage.setItem('tracker_state', JSON.stringify({ batches: [{ id: 'b1' }] }));
    storage.setItem('tracker_settings', JSON.stringify({ language: 'en' }));
    storage.setItem('tracker_write_generation', '42');
  });

  it('keeps the caches when the same user claims the device again', () => {
    claimLocalScope('user-a', storage);
    const wiped = claimLocalScope('user-a', storage);

    expect(wiped).toBe(false);
    expect(storage.getItem('tracker_state')).toContain('b1');
    expect(storage.getItem('tracker_settings')).toContain('en');
  });

  it('wipes the caches when a different user claims the device', () => {
    claimLocalScope('user-a', storage);
    const wiped = claimLocalScope('user-b', storage);

    expect(wiped).toBe(true);
    expect(storage.getItem('tracker_state')).toBeNull();
    expect(storage.getItem('tracker_settings')).toBeNull();
    expect(storage.getItem('tracker_write_generation')).toBeNull();
    expect(getLocalScopeOwner(storage)).toBe('user-b');
  });

  it('adopts an unowned device without wiping it', () => {
    const wiped = claimLocalScope('user-a', storage);

    expect(wiped).toBe(false);
    expect(storage.getItem('tracker_state')).toContain('b1');
    expect(getLocalScopeOwner(storage)).toBe('user-a');
  });

  it('drops the caches and the owner stamp on sign-out', () => {
    claimLocalScope('user-a', storage);
    releaseLocalScope(storage);

    expect(storage.getItem('tracker_state')).toBeNull();
    expect(storage.getItem('tracker_settings')).toBeNull();
    expect(getLocalScopeOwner(storage)).toBeNull();
  });
});
