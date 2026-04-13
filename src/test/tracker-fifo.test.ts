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
});