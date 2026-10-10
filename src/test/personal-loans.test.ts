import { describe, expect, it } from 'vitest';
import { personalLoanOutstanding, personalLoanRepaid, type PersonalLoan } from '@/lib/trading/personal-loans';

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
});
