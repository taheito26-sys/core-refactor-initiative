import { describe, it, expect } from 'vitest';
import { mergeTrackerStatesForMerchant } from '@/lib/tracker-sync';

describe('mergeTrackerStatesForMerchant', () => {
  it('merges batches/trades/customers across merchant user snapshots without duplicates', () => {
    const merged = mergeTrackerStatesForMerchant([
      {
        updated_at: '2026-04-01T00:00:00.000Z',
        state: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          batches: [{ id: 'b1', ts: 1, source: 'A', initialUSDT: 10, buyPriceQAR: 3.5, note: '' } as any],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          trades: [{ id: 't1', ts: 2, inputMode: 'USDT', amountUSDT: 1, sellPriceQAR: 4, feeQAR: 0, note: '', voided: false, usesStock: true, revisions: [], customerId: '' } as any],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          customers: [{ id: 'c1', name: 'Foo', phone: '' } as any],
        },
      },
      {
        updated_at: '2026-04-02T00:00:00.000Z',
        state: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          batches: [{ id: 'b2', ts: 3, source: 'B', initialUSDT: 20, buyPriceQAR: 3.6, note: '' } as any],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          trades: [{ id: 't2', ts: 4, inputMode: 'USDT', amountUSDT: 2, sellPriceQAR: 4.1, feeQAR: 0, note: '', voided: false, usesStock: true, revisions: [], customerId: '' } as any],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          customers: [{ id: 'c2', name: 'Bar', phone: '' } as any],
        },
      },
      {
        updated_at: '2026-04-03T00:00:00.000Z',
        state: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          trades: [{ id: 't2', ts: 5, inputMode: 'USDT', amountUSDT: 2, sellPriceQAR: 4.2, feeQAR: 0, note: 'updated', voided: false, usesStock: true, revisions: [], customerId: '' } as any],
        },
      },
    ]);

    expect(merged?.batches).toHaveLength(2);
    expect(merged?.trades).toHaveLength(2);
    expect(merged?.customers).toHaveLength(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t2 = (merged?.trades as any[]).find((t) => t.id === 't2');
    expect(t2?.sellPriceQAR).toBe(4.2);
    expect(t2?.note).toBe('updated');
  });

  it('does not resurrect a trade that was truly removed and tombstoned, even when an older snapshot still carries it', () => {
    // Reproduces the exact failure this test guards against: a device saved
    // an older row that still has the trade; without deletedTradeIds being
    // unioned and filtered, mergeArrayById would let that stale copy win.
    const merged = mergeTrackerStatesForMerchant([
      {
        updated_at: '2026-04-01T00:00:00.000Z',
        state: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          trades: [{ id: 't1', ts: 1, inputMode: 'USDT', amountUSDT: 100, sellPriceQAR: 3.8, feeQAR: 0, note: '', voided: false, usesStock: true, revisions: [], customerId: '' } as any],
        },
      },
      {
        // A later snapshot (from the device that actually did the delete)
        // no longer carries t1 at all, and tombstones it.
        updated_at: '2026-04-02T00:00:00.000Z',
        state: {
          trades: [],
          deletedTradeIds: ['t1'],
        },
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((merged?.trades as any[]).find((t) => t.id === 't1')).toBeUndefined();
    expect(merged?.deletedTradeIds).toContain('t1');
  });
});
