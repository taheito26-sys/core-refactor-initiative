import { describe, it, expect } from 'vitest';
import {
  isLoanClosed,
  getLoanClosedAt,
  monthKey,
  groupClosedLoansByMonth,
  loanMatchesQuery,
} from './loanGrouping';
import type { CustomerLoan, Customer } from '@/lib/tracker-helpers';

const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime();

function loan(over: Partial<CustomerLoan> & { id: string }): CustomerLoan {
  return {
    ts: at(2026, 0, 10),
    customerId: 'cust-a',
    principal: 1000,
    currency: 'QAR',
    repayments: [],
    status: 'open',
    createdAt: at(2026, 0, 10),
    ...over,
  };
}

const customers = [
  { id: 'cust-a', name: 'Ahmed' },
  { id: 'cust-b', name: 'Mohamed' },
] as Customer[];

describe('isLoanClosed', () => {
  it('treats a fully repaid loan as closed even when still flagged open', () => {
    expect(isLoanClosed(loan({ id: 'l1', principal: 500, repayments: [{ id: 'r', ts: 1, amount: 500 }] }))).toBe(true);
  });

  it('treats a flagged-closed loan as closed', () => {
    expect(isLoanClosed(loan({ id: 'l1', status: 'closed' }))).toBe(true);
  });

  it('leaves a partly repaid loan open', () => {
    expect(isLoanClosed(loan({ id: 'l1', principal: 500, repayments: [{ id: 'r', ts: 1, amount: 200 }] }))).toBe(false);
  });
});

describe('getLoanClosedAt', () => {
  it('uses the last repayment', () => {
    const l = loan({
      id: 'l1',
      repayments: [
        { id: 'r1', ts: at(2026, 2, 5), amount: 400 },
        { id: 'r2', ts: at(2026, 4, 9), amount: 600 },
        { id: 'r3', ts: at(2026, 3, 1), amount: 0 },
      ],
    });
    expect(getLoanClosedAt(l)).toBe(at(2026, 4, 9));
  });

  it('falls back to the loan date when nothing was repaid', () => {
    expect(getLoanClosedAt(loan({ id: 'l1', status: 'closed' }))).toBe(at(2026, 0, 10));
  });
});

describe('monthKey', () => {
  it('zero-pads the month', () => {
    expect(monthKey(at(2026, 2, 9))).toBe('2026-03');
    expect(monthKey(at(2026, 11, 31))).toBe('2026-12');
  });
});

describe('groupClosedLoansByMonth', () => {
  it('buckets by the month the loan was settled, newest month first', () => {
    const loans = [
      loan({ id: 'mar', principal: 500, repayments: [{ id: 'r', ts: at(2026, 2, 20), amount: 500 }] }),
      loan({ id: 'may', principal: 700, repayments: [{ id: 'r', ts: at(2026, 4, 2), amount: 700 }] }),
      loan({ id: 'may2', customerId: 'cust-b', principal: 300, repayments: [{ id: 'r', ts: at(2026, 4, 25), amount: 300 }] }),
      loan({ id: 'still-open', principal: 900, repayments: [{ id: 'r', ts: at(2026, 4, 25), amount: 100 }] }),
    ];
    const groups = groupClosedLoansByMonth(loans, customers);
    expect(groups.map(g => g.key)).toEqual(['2026-05', '2026-03']);
    expect(groups[0]).toMatchObject({ year: 2026, month: 4 });
    // Newest settlement first within the month.
    expect(groups[0].entries.map(e => e.loan.id)).toEqual(['may2', 'may']);
    expect(groups[0].totalsByCurrency).toEqual([['QAR', { given: 1000, received: 1000, remaining: 0 }]]);
    expect(groups[1].entries.map(e => e.loan.id)).toEqual(['mar']);
  });

  it('files a closed loan with no repayments under its own date', () => {
    const loans = [loan({ id: 'zero', ts: at(2026, 7, 4), status: 'closed', principal: 0 })];
    const [group] = groupClosedLoansByMonth(loans, customers);
    expect(group.key).toBe('2026-08');
    expect(group.entries[0].closedAt).toBe(at(2026, 7, 4));
  });

  it('attaches the customer to each entry', () => {
    const loans = [loan({ id: 'a', customerId: 'cust-b', status: 'closed' })];
    const [group] = groupClosedLoansByMonth(loans, customers);
    expect(group.entries[0].customer?.name).toBe('Mohamed');
  });
});

describe('loanMatchesQuery', () => {
  const l = loan({ id: 'l1', principal: 4500, note: 'Pays after payday' });

  it('matches everything on an empty query', () => {
    expect(loanMatchesQuery(l, 'Ahmed', '   ')).toBe(true);
  });

  it('matches customer name case-insensitively', () => {
    expect(loanMatchesQuery(l, 'Ahmed', 'ahm')).toBe(true);
  });

  it('matches the note and the amount', () => {
    expect(loanMatchesQuery(l, 'Ahmed', 'payday')).toBe(true);
    expect(loanMatchesQuery(l, 'Ahmed', '4500')).toBe(true);
  });

  it('rejects a non-match', () => {
    expect(loanMatchesQuery(l, 'Ahmed', 'zzz')).toBe(false);
  });
});
