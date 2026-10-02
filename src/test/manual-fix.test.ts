import { describe, expect, it } from 'vitest';
import { buildManualFixBatch, planManualFix } from '@/features/stock/manual-fix';
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
