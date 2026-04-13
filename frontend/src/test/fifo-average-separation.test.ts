import { describe, expect, it } from 'vitest';

import { computeFIFO, getWACOP, type Batch, type Trade } from '@/lib/tracker-helpers';

describe('average stock metric vs transaction FIFO preview', () => {
  it('keeps average-stock price distinct from sale-specific FIFO unit cost', () => {
    const batches: Batch[] = [
      { id: 'b1', ts: 1, source: 's1', note: '', buyPriceQAR: 3.5, initialUSDT: 100, revisions: [] },
      { id: 'b2', ts: 2, source: 's2', note: '', buyPriceQAR: 3.9, initialUSDT: 100, revisions: [] },
    ];
    const sale: Trade = {
      id: 'preview',
      ts: 3,
      inputMode: 'USDT',
      amountUSDT: 60,
      sellPriceQAR: 4,
      feeQAR: 0,
      note: '',
      voided: false,
      usesStock: true,
      revisions: [],
      customerId: '',
    };

    const preSale = computeFIFO(batches, []);
    const averageStockPrice = getWACOP(preSale);
    const preview = computeFIFO(batches, [sale]).tradeCalc.get('preview');

    expect(averageStockPrice).toBe(3.7);
    expect(preview?.avgBuyQAR).toBe(3.5);
    expect(preview?.avgBuyQAR).not.toBe(averageStockPrice);
  });
});

