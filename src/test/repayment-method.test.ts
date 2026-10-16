import { describe, expect, it } from 'vitest';
import { buildActivity } from '@/features/customer/home/home-model';
import { groupPayments, type StatementEntry } from '@/features/stock/utils/loanStatement';
import { editRepayment } from '@/features/stock/utils/loanRepayments';
import type { CustomerLoan } from '@/lib/tracker-helpers';

const entry = (over: Partial<StatementEntry>): StatementEntry => ({
  id: 'p1', ts: 1000, kind: 'payment', ref: 'A', description: '', debit: 0, credit: 100, balance: 0, loanId: 'l1', ...over,
});

describe('payment method (cash or bank)', () => {
  it('keeps the method on the grouped payment the buyer sees', () => {
    const [g] = groupPayments([entry({ batchId: 'b', method: 'cash' }), entry({ id: 'p2', batchId: 'b' })]);
    expect(g.method).toBe('cash');
    expect(groupPayments([entry({})])[0].method).toBeUndefined();
  });

  it('carries the method onto the buyer activity row', () => {
    const rows = buildActivity({
      orders: [],
      payments: [{ date: 3000, amount: 38000, method: 'cash' }, { date: 2000, amount: 12000, method: 'bank' }, { date: 1000, amount: 5 }],
    });
    expect(rows.map(r => r.method ?? null)).toEqual(['cash', 'bank', null]);
  });

  it('records the method chosen when a payment is edited, and keeps it when none is given', () => {
    const loan = {
      id: 'l1', ts: 1, customerId: 'c', principal: 1000, currency: 'QAR', status: 'open', createdAt: 1,
      repayments: [{ id: 'r1', ts: 5, amount: 100, method: 'bank' as const }],
    } as CustomerLoan;
    const toCash = editRepayment(loan, 'r1', { amount: 100, ts: 5, method: 'cash' }, [], '');
    expect(toCash?.loan.repayments?.[0].method).toBe('cash');
    const untouched = editRepayment(loan, 'r1', { amount: 100, ts: 5 }, [], '');
    expect(untouched?.loan.repayments?.[0].method).toBe('bank');
  });
});
