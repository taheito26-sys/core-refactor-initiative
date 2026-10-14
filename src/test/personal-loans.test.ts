import { describe, expect, it } from 'vitest';
import { deletePersonalRepayment, editPersonalRepayment, personalLoanOutstanding, personalLoanRepaid, type PersonalLoan } from '@/lib/trading/personal-loans';
import type { CashLedgerEntry } from '@/lib/tracker-helpers';

const D = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();
const loan = (over: Partial<PersonalLoan> = {}): PersonalLoan => ({
  id: 'p1', person: 'Ahmed', principal: 7000, currency: 'QAR', lentAt: D(2026, 9, 10), repayments: [], ...over,
});

describe('personal loans', () => {
  it('owes nothing before it was lent, then the principal less repayments made by the date', () => {
    const l = loan({ repayments: [{ id: 'r1', ts: D(2026, 9, 20), amount: 2000 }, { id: 'r2', ts: D(2026, 10, 3), amount: 1000 }] });
    expect(personalLoanOutstanding(l, D(2026, 9, 1))).toBe(0);
    expect(personalLoanOutstanding(l, D(2026, 9, 15))).toBe(7000);
    expect(personalLoanOutstanding(l, D(2026, 9, 30))).toBe(5000);
    expect(personalLoanOutstanding(l)).toBe(4000);
    expect(personalLoanRepaid(l)).toBe(3000);
  });

  it('never goes below zero when repaid more than lent', () => {
    expect(personalLoanOutstanding(loan({ repayments: [{ id: 'r', ts: D(2026, 9, 11), amount: 9000 }] }))).toBe(0);
  });

  const row = (id: string, amount: number): CashLedgerEntry => ({ id, ts: D(2026, 9, 20), type: 'loan_repayment', accountId: 'a', direction: 'in', amount, currency: 'QAR' });
  const lent50k = () => loan({ principal: 50000, repayments: [{ id: 'r1', ts: D(2026, 9, 20), amount: 20000, ledgerEntryId: 'l1' }] });

  it('corrects a repayment and moves its cash row with it', () => {
    const res = editPersonalRepayment(lent50k(), 'r1', { amount: 15000, ts: D(2026, 9, 21) }, [row('l1', 20000), row('other', 5)]);
    expect(personalLoanOutstanding(res!.loan)).toBe(35000);
    expect(res!.ledger.find(e => e.id === 'l1')?.amount).toBe(15000);
    expect(res!.ledger.find(e => e.id === 'other')?.amount).toBe(5);
  });

  it('removes a repayment and its cash row, reopening the balance', () => {
    const res = deletePersonalRepayment(lent50k(), 'r1', [row('l1', 20000)]);
    expect(personalLoanOutstanding(res!.loan)).toBe(50000);
    expect(res!.ledger).toEqual([]);
  });

  it('returns null for an unknown repayment', () => {
    expect(editPersonalRepayment(lent50k(), 'nope', { amount: 1, ts: 1 }, [])).toBeNull();
    expect(deletePersonalRepayment(lent50k(), 'nope', [])).toBeNull();
  });
});
