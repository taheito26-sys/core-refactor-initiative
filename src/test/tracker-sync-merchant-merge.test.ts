import { describe, it, expect } from 'vitest';
import { mergeTrackerStatesForMerchant } from '@/lib/tracker-sync';

describe('mergeTrackerStatesForMerchant', () => {
  it('merges batches/trades/customers across merchant user snapshots without duplicates', () => {
    const merged = mergeTrackerStatesForMerchant([
      {
        updated_at: '2026-04-01T00:00:00.000Z',
        state: {
          batches: [{ id: 'b1', ts: 1, source: 'A', initialUSDT: 10, buyPriceQAR: 3.5, note: '' } as any],
          trades: [{ id: 't1', ts: 2, inputMode: 'USDT', amountUSDT: 1, sellPriceQAR: 4, feeQAR: 0, note: '', voided: false, usesStock: true, revisions: [], customerId: '' } as any],
          customers: [{ id: 'c1', name: 'Foo', phone: '' } as any],
        },
      },
      {
        updated_at: '2026-04-02T00:00:00.000Z',
        state: {
          batches: [{ id: 'b2', ts: 3, source: 'B', initialUSDT: 20, buyPriceQAR: 3.6, note: '' } as any],
          trades: [{ id: 't2', ts: 4, inputMode: 'USDT', amountUSDT: 2, sellPriceQAR: 4.1, feeQAR: 0, note: '', voided: false, usesStock: true, revisions: [], customerId: '' } as any],
          customers: [{ id: 'c2', name: 'Bar', phone: '' } as any],
        },
      },
      {
        updated_at: '2026-04-03T00:00:00.000Z',
        state: {
          trades: [{ id: 't2', ts: 5, inputMode: 'USDT', amountUSDT: 2, sellPriceQAR: 4.2, feeQAR: 0, note: 'updated', voided: false, usesStock: true, revisions: [], customerId: '' } as any],
        },
      },
    ]);

    expect(merged?.batches).toHaveLength(2);
    expect(merged?.trades).toHaveLength(2);
    expect(merged?.customers).toHaveLength(2);
    const t2 = (merged?.trades as any[]).find((t) => t.id === 't2');
    expect(t2?.sellPriceQAR).toBe(4.2);
    expect(t2?.note).toBe('updated');
  });
});
