import { describe, expect, it } from 'vitest';

import { computeFIFO, type Batch, type Trade } from '@/lib/tracker-helpers';

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-1',
    ts: 2,
    inputMode: 'USDT',
    amountUSDT: 1000,
    sellPriceQAR: 3.86,
    feeQAR: 0,
    note: '',
    voided: false,
    usesStock: true,
    revisions: [],
    customerId: '',
    ...overrides,
  };
}

describe('computeFIFO', () => {
  it('marks partial stock matches as invalid and zeroes derived preview values', () => {
    const batches: Batch[] = [
      {
        id: 'batch-1',
        ts: 1,
        source: 'supplier-a',
        note: '',
        buyPriceQAR: 3.7,
        initialUSDT: 354,
        revisions: [],
      },
    ];

    const calc = computeFIFO(batches, [makeTrade({ amountUSDT: 10000 })]).tradeCalc.get('trade-1');

    expect(calc).toBeDefined();
    expect(calc?.ok).toBe(false);
    expect(calc?.avgBuyQAR).toBe(0);
    expect(calc?.netQAR).toBe(0);
    expect(calc?.margin).toBe(0);
    expect(calc?.slices).toHaveLength(1);
  });

  it('keeps exact FIFO values for fully matched trades', () => {
    const batches: Batch[] = [
      {
        id: 'batch-1',
        ts: 1,
        source: 'supplier-a',
        note: '',
        buyPriceQAR: 3.7,
        initialUSDT: 1000,
        revisions: [],
      },
    ];

    const calc = computeFIFO(batches, [makeTrade()]).tradeCalc.get('trade-1');

    expect(calc?.ok).toBe(true);
    expect(calc?.avgBuyQAR).toBe(3.7);
    expect(calc?.netQAR).toBe(160);
    expect(calc?.margin).toBeCloseTo((160 / 3860) * 100, 8);
  });

  it('respects merchant-aware layer priority order from selectEligibleBatches', () => {
    const batches: Batch[] = [
      { id: 'global-old', ts: 1, source: 'other-supplier', note: '', buyPriceQAR: 3.4, initialUSDT: 100, revisions: [] },
      { id: 'merchant-new', ts: 10, source: 'merchant-x-wallet', note: '', buyPriceQAR: 3.9, initialUSDT: 100, revisions: [] },
    ];
    const trade = makeTrade({ amountUSDT: 120, linkedMerchantId: 'merchant-x', sellPriceQAR: 4 });
    const calc = computeFIFO(batches, [trade]).tradeCalc.get('trade-1');

    expect(calc?.ok).toBe(true);
    expect(calc?.slices).toEqual([
      { batchId: 'merchant-new', qty: 100, cost: 390 },
      { batchId: 'global-old', qty: 20, cost: 68 },
    ]);
  });

  it('handles exact and partial multi-layer consumption deterministically', () => {
    const batches: Batch[] = [
      { id: 'b1', ts: 1, source: 'a', note: '', buyPriceQAR: 3.5, initialUSDT: 50, revisions: [] },
      { id: 'b2', ts: 2, source: 'a', note: '', buyPriceQAR: 3.6, initialUSDT: 50, revisions: [] },
      { id: 'b3', ts: 3, source: 'a', note: '', buyPriceQAR: 3.7, initialUSDT: 50, revisions: [] },
    ];

    const exact = computeFIFO(batches, [makeTrade({ id: 'exact', amountUSDT: 100, sellPriceQAR: 4 })]).tradeCalc.get('exact');
    expect(exact?.ok).toBe(true);
    expect(exact?.slices).toEqual([
      { batchId: 'b1', qty: 50, cost: 175 },
      { batchId: 'b2', qty: 50, cost: 180 },
    ]);

    const partial = computeFIFO(batches, [makeTrade({ id: 'partial', amountUSDT: 120, sellPriceQAR: 4 })]).tradeCalc.get('partial');
    expect(partial?.ok).toBe(true);
    expect(partial?.slices).toEqual([
      { batchId: 'b1', qty: 50, cost: 175 },
      { batchId: 'b2', qty: 50, cost: 180 },
      { batchId: 'b3', qty: 20, cost: 74 },
    ]);
  });
});
