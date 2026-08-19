import { describe, it, expect } from 'vitest';
import { getMonthlyLoanPayments, type CustomerLoan } from './tracker-helpers';

/** A loan carrying the given repayment timestamps/amounts. */
function loan(
  id: string,
  repayments: Array<{ id: string; ts: number; amount: number; note?: string }>,
  overrides: Partial<CustomerLoan> = {},
): CustomerLoan {
  return {
    id,
    ts: Date.UTC(2026, 0, 1),
    customerId: `cust-${id}`,
    principal: 10000,
    currency: 'QAR',
    status: 'open',
    createdAt: Date.UTC(2026, 0, 1),
    repayments,
    ...overrides,
  };
}

/** Local-time timestamp — the calendar buckets by the viewer's local date. */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

describe('getMonthlyLoanPayments', () => {
  it('buckets repayments by day of month', () => {
    const loans = [loan('a', [
      { id: 'r1', ts: at(2026, 7, 3), amount: 500 },
      { id: 'r2', ts: at(2026, 7, 3), amount: 250 },
      { id: 'r3', ts: at(2026, 7, 19), amount: 1000 },
    ])];

    const byDay = getMonthlyLoanPayments(loans, [], 2026, 7);

    expect(Object.keys(byDay).sort()).toEqual(['19', '3']);
    expect(byDay[3].map(p => p.amount)).toEqual([500, 250]);
    expect(byDay[19].map(p => p.amount)).toEqual([1000]);
  });

  it('ignores repayments outside the requested month or year', () => {
    const loans = [loan('a', [
      { id: 'r1', ts: at(2026, 6, 31), amount: 100 },  // Jul 2026
      { id: 'r2', ts: at(2026, 7, 1), amount: 200 },   // Aug 2026 ✓
      { id: 'r3', ts: at(2026, 8, 1), amount: 300 },   // Sep 2026
      { id: 'r4', ts: at(2025, 7, 1), amount: 400 },   // Aug 2025
    ])];

    const byDay = getMonthlyLoanPayments(loans, [], 2026, 7);

    expect(byDay).toEqual({ 1: [expect.objectContaining({ amount: 200 })] });
  });

  it('merges payments from several loans onto the same day', () => {
    const loans = [
      loan('a', [{ id: 'r1', ts: at(2026, 7, 10), amount: 500 }]),
      loan('b', [{ id: 'r2', ts: at(2026, 7, 10), amount: 700 }], { customerId: 'cust-b' }),
    ];

    const byDay = getMonthlyLoanPayments(loans, [], 2026, 7);

    expect(byDay[10]).toHaveLength(2);
    expect(byDay[10].map(p => p.customerId).sort()).toEqual(['cust-a', 'cust-b']);
  });

  it('skips loans that have been tombstoned', () => {
    const loans = [
      loan('kept', [{ id: 'r1', ts: at(2026, 7, 5), amount: 500 }]),
      loan('gone', [{ id: 'r2', ts: at(2026, 7, 5), amount: 900 }]),
    ];

    const byDay = getMonthlyLoanPayments(loans, ['gone'], 2026, 7);

    expect(byDay[5]).toHaveLength(1);
    expect(byDay[5][0].amount).toBe(500);
  });

  it('carries the loan currency and the repayment note through', () => {
    const loans = [loan('a', [
      { id: 'r1', ts: at(2026, 7, 8), amount: 300, note: 'bank transfer' },
    ], { currency: 'USDT' })];

    expect(getMonthlyLoanPayments(loans, [], 2026, 7)[8][0]).toMatchObject({
      currency: 'USDT', note: 'bank transfer', amount: 300,
    });
  });

  it('drops zero and unparseable amounts rather than rendering empty rows', () => {
    const loans = [loan('a', [
      { id: 'r1', ts: at(2026, 7, 4), amount: 0 },
      { id: 'r2', ts: at(2026, 7, 4), amount: Number.NaN },
      { id: 'r3', ts: at(2026, 7, 4), amount: 120 },
    ])];

    expect(getMonthlyLoanPayments(loans, [], 2026, 7)[4]).toHaveLength(1);
  });

  it('returns nothing for loans with no repayments, and for no loans at all', () => {
    expect(getMonthlyLoanPayments([loan('a', [])], [], 2026, 7)).toEqual({});
    expect(getMonthlyLoanPayments(undefined, undefined, 2026, 7)).toEqual({});
  });
});
