import { describe, expect, it } from 'vitest';
import { syncOrderLoan, findOrderLoan } from '@/features/orders/utils/orderLoan';
import type { TrackerState } from '@/lib/tracker-helpers';

const base = { customerLoans: [], cashAccounts: [], cashLedger: [] } as unknown as TrackerState;
const input = { tradeId: 't1', customerId: 'c1', ts: 1, amountUSDT: 100, sell: 3.6, fee: 0, currency: 'QAR' as const, note: 'Loan 100 USDT @ 3.6' };

describe('emergency loaned orders', () => {
  it('flags a new loan as emergency only when asked', () => {
    const normal = syncOrderLoan({ ...input, nextState: base, isLoan: true });
    expect(findOrderLoan(normal.state, 't1')?.emergency).toBeUndefined();
    const urgent = syncOrderLoan({ ...input, nextState: base, isLoan: true, emergency: true });
    expect(findOrderLoan(urgent.state, 't1')?.emergency).toBe(true);
  });

  it('switches an existing loan between normal and emergency', () => {
    const created = syncOrderLoan({ ...input, nextState: base, isLoan: true }).state;
    const toUrgent = syncOrderLoan({ ...input, nextState: created, isLoan: true, emergency: true });
    expect(toUrgent.outcome).toBe('updated');
    expect(findOrderLoan(toUrgent.state, 't1')?.emergency).toBe(true);
    const back = syncOrderLoan({ ...input, nextState: toUrgent.state, isLoan: true });
    expect(back.outcome).toBe('updated');
    expect(findOrderLoan(back.state, 't1')?.emergency).toBeUndefined();
  });
});
