import { describe, it, expect, vi, afterEach } from 'vitest';
import { guardTombstones } from '@/lib/tracker-sync';

describe('guardTombstones', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unions a small, ordinary number of new tombstones', () => {
    const result = guardTombstones('customers', ['a'], ['a', 'b'], 40);
    expect(result).toEqual(['a', 'b']);
  });

  it('refuses a save that tombstones a large slice of a populated collection at once', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // The exact shape of the reported incident: cloud has 34 real customers,
    // and this save's local state (post sign-out/sign-in) only knows about
    // a handful, tombstoning the rest in one shot.
    const latest: string[] = [];
    const incoming = Array.from({ length: 29 }, (_, i) => `customer-${i}`);

    const result = guardTombstones('customers', latest, incoming, 34);

    expect(result).toEqual([]);
    expect(console.error).toHaveBeenCalledOnce();
  });

  it('still allows a genuine bulk delete against a small collection', () => {
    // 4 of 5 batches removed — a big fraction, but the collection itself is
    // small, so this is plausibly a real cleanup rather than a bug wiping
    // out data the device just doesn't currently know about.
    const result = guardTombstones('batches', [], ['b1', 'b2', 'b3', 'b4'], 5);
    expect(result).toEqual(['b1', 'b2', 'b3', 'b4']);
  });

  it('allows a handful of new tombstones even against a large collection', () => {
    // mergeCustomerRecords only ever tombstones one id per duplicate-merge
    // action, so a merchant folding a few duplicates in a row must not trip
    // the breaker.
    const result = guardTombstones('customers', [], ['c1', 'c2', 'c3'], 40);
    expect(result).toEqual(['c1', 'c2', 'c3']);
  });
});
