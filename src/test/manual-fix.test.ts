import { computeFIFO, totalStock, type Batch, type Trade } from '@/lib/tracker-helpers';
import { describe, expect, it } from 'vitest';
import { buildBalanceFixBatch, canApplyBalanceReductions, buildManualFixBatch, planManualFix } from '@/features/stock/manual-fix';
import type { PendingExchangeItem } from '@/features/exchanges/reconcile';

const item = (effect: number, reference = 'R1', source: 'order' | 'transfer' = 'transfer'): PendingExchangeItem => ({
  key: reference, source, exchange: 'binance', direction: effect > 0 ? 'out' : 'in', ts: 1, pendingUSDT: Math.abs(effect),
  effect, counterparty: null, reference,
});

describe('planManualFix', () => {
  it('trims stock when the records leave the tracker higher than the exchange', () => {
    expect(planManualFix([item(5999), item(-1999)])).toEqual({ mode: 'trim', amount: 4000 });
  });
  it('adds stock when the exchange holds more', () => {
    expect(planManualFix([item(-1999)])).toEqual({ mode: 'add', amount: 1999 });
  });
  it('does nothing when the records cancel out', () => {
    expect(planManualFix([item(100), item(-100)])).toEqual({ mode: 'none', amount: 0 });
  });
});

describe('buildManualFixBatch', () => {
  it('makes an unfunded batch that names the records it fixes', () => {
    const b = buildManualFixBatch({ amount: 1999, priceQAR: 3.7, items: [item(-1999, '0xabc')], note: 'checked', now: 5, id: 'b1' });
    expect(b).toMatchObject({ id: 'b1', ts: 5, source: 'Manual fix', buyPriceQAR: 3.7, initialUSDT: 1999 });
    expect(b.fundingAccountId).toBeUndefined();
    expect(b.note).toContain('checked');
    expect(b.note).toContain('0xabc');
  });
});

describe('exact balance corrections', () => {
  it('requires the entire difference and rejects excessive or invalid batch reductions', () => {
    const batches = [{ id: 'a', remaining: 100 }, { id: 'b', remaining: 200 }];
    expect(canApplyBalanceReductions(178, [{ batchId: 'a', amount: 100 }, { batchId: 'b', amount: 78 }], batches)).toBe(true);
    for (const reductions of [
      [{ batchId: 'b', amount: 177 }],
      [{ batchId: 'b', amount: 179 }],
      [{ batchId: 'a', amount: 178 }],
      [{ batchId: 'missing', amount: 178 }],
      [{ batchId: 'a', amount: 89 }, { batchId: 'a', amount: 89 }],
    ]) expect(canApplyBalanceReductions(178, reductions, batches)).toBe(false);
  });

  it('reduces a tracker surplus to exactly the exchange balance', () => {
    const batches: Batch[] = [{ id: 'a', ts: 1, source: 'supplier', note: '', initialUSDT: 12647, buyPriceQAR: 3.7, revisions: [] }];
    const reductions = [{ batchId: 'a', amount: 178 }];
    expect(canApplyBalanceReductions(178, reductions, [{ id: 'a', remaining: 12647 }])).toBe(true);
    const next = batches.map(b => ({ ...b, initialUSDT: b.initialUSDT - reductions[0].amount }));
    expect(totalStock(computeFIFO(next, []))).toBe(12469);
  });

  it('matches the screenshot balance including older stock and decimal amounts', () => {
    const batches: Batch[] = [{ id: 'old', ts: 1, source: 'supplier', note: '', initialUSDT: 12469, buyPriceQAR: 3.7, revisions: [] }];
    const state = { batches, trades: [], usdtTransfers: [] };
    const exchangeTotal = 12647.12345678;
    const batch = buildBalanceFixBatch({ state, exchangeTotal, amount: exchangeTotal - totalStock(computeFIFO(batches, [])), priceQAR: 3.7, items: [], now: 10 });
    expect(totalStock(computeFIFO([...batches, batch], []))).toBeCloseTo(exchangeTotal, 8);
  });

  it('closes the gap even when previous uncovered sales consume the new batch', () => {
    const trades: Trade[] = [{ id: 'sale', ts: 2, inputMode: 'USDT', amountUSDT: 300, sellPriceQAR: 3.8, feeQAR: 0, note: '', voided: false, usesStock: true, revisions: [], customerId: '' }];
    const state = { batches: [], trades, usdtTransfers: [] };
    const batch = buildBalanceFixBatch({ state, exchangeTotal: 178, amount: 178, priceQAR: 3.7, items: [], now: 10 });
    expect(batch.initialUSDT).toBe(478);
    expect(totalStock(computeFIFO([batch], trades))).toBe(178);
    expect(batch.fundingAccountId).toBeUndefined();
  });
});
