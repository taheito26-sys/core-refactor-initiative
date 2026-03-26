import { describe, expect, it } from 'vitest';
import { allocateFunding, appendCashLedger, getCashAccounts } from '@/lib/cash-ledger';
import type { TrackerState } from '@/lib/tracker-helpers';

const baseState: TrackerState = {
  currency: 'QAR',
  range: 'all',
  batches: [],
  trades: [],
  customers: [],
  cashQAR: 15000,
  cashOwner: 'Cash on Hand',
  cashHistory: [
    { id: '1', ts: 1, type: 'deposit', amount: 10000, balanceAfter: 10000, owner: 'Cash on Hand', bankAccount: 'Cash on Hand', note: '' },
    { id: '2', ts: 2, type: 'deposit', amount: 5000, balanceAfter: 15000, owner: 'Cash on Hand', bankAccount: 'QNB Bank', note: '' },
  ],
  cashAccounts: [],
  cashLedger: [],
  settings: { lowStockThreshold: 0, priceAlertThreshold: 0 },
  cal: { year: 2026, month: 1, selectedDay: null },
};

describe('cash ledger integration', () => {
  it('split funding allocates from multiple accounts', () => {
    const accounts = getCashAccounts(baseState);
    const allocations = allocateFunding(accounts, 15000, 'auto');
    expect(allocations.length).toBe(2);
    expect(allocations.reduce((s, a) => s + a.amount, 0)).toBe(15000);
  });

  it('insufficient funds returns no allocation', () => {
    const accounts = getCashAccounts(baseState);
    const allocations = allocateFunding(accounts, 20000, 'auto');
    expect(allocations).toEqual([]);
  });

  it('order funding decreases balance and refund restores it', () => {
    const funded = appendCashLedger(baseState, [{ type: 'order_funding', amount: 1000, owner: 'Cash on Hand', bankAccount: 'Cash on Hand', note: 'Order', orderId: 'o1' }]);
    expect(funded.cashQAR).toBe(14000);
    const refunded = appendCashLedger(funded, [{ type: 'order_refund', amount: 1000, owner: 'Cash on Hand', bankAccount: 'Cash on Hand', note: 'Refund', orderId: 'o1' }]);
    expect(refunded.cashQAR).toBe(15000);
  });
});
