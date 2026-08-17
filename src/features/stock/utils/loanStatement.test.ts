import { describe, it, expect } from 'vitest';
import { buildBuyerStatements, shortRef, statementMatchesQuery, totalsByCurrency } from './loanStatement';
import type { CashAccount, Customer, CustomerLoan, Trade } from '@/lib/tracker-helpers';

const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime();
const NOW = at(2026, 7, 17);

function loan(over: Partial<CustomerLoan> & { id: string }): CustomerLoan {
  return {
    ts: at(2026, 7, 1),
    customerId: 'cust-a',
    principal: 1000,
    currency: 'QAR',
    repayments: [],
    status: 'open',
    createdAt: at(2026, 7, 1),
    ...over,
  };
}

const customers = [
  { id: 'cust-a', name: 'Ahmed', phone: '+974 5000 1111' },
  { id: 'cust-b', name: 'Mohamed' },
] as Customer[];

const accounts = [{ id: 'acc-1', name: 'QNB Bank' }] as CashAccount[];
const trades = [{ id: 'trade-abc123', customerId: 'cust-a' }] as Trade[];

describe('buildBuyerStatements', () => {
  it('rolls a buyer’s loans into one account with totals and a running balance', () => {
    const loans = [
      loan({ id: 'l1', ts: at(2026, 6, 1), principal: 5000, repayments: [{ id: 'r1', ts: at(2026, 6, 20), amount: 2000 }] }),
      loan({ id: 'l2', ts: at(2026, 7, 5), principal: 3000 }),
    ];

    const [stmt] = buildBuyerStatements({ loans, customers, accounts, now: NOW });

    expect(stmt.customerName).toBe('Ahmed');
    expect(stmt.phone).toBe('+974 5000 1111');
    expect(stmt.totalLoaned).toBe(8000);
    expect(stmt.totalRepaid).toBe(2000);
    expect(stmt.outstanding).toBe(6000);
    expect(stmt.openCount).toBe(2);
    // Charge → payment → charge, with the balance owed after each row.
    expect(stmt.entries.map(e => [e.kind, e.debit, e.credit, e.balance])).toEqual([
      ['charge', 5000, 0, 5000],
      ['payment', 0, 2000, 3000],
      ['charge', 3000, 0, 6000],
    ]);
  });

  it('keeps a same-day loan and repayment in charge-then-payment order', () => {
    const day = at(2026, 7, 10);
    const loans = [loan({ id: 'l1', ts: day, principal: 400, repayments: [{ id: 'r1', ts: day, amount: 400 }] })];

    const [stmt] = buildBuyerStatements({ loans, customers, now: NOW });

    expect(stmt.entries.map(e => e.kind)).toEqual(['charge', 'payment']);
    expect(stmt.entries.every(e => e.balance >= 0)).toBe(true);
  });

  it('splits a buyer’s currencies into separate statements', () => {
    const loans = [
      loan({ id: 'qar', principal: 1000 }),
      loan({ id: 'usdt', principal: 250, currency: 'USDT' }),
    ];

    const statements = buildBuyerStatements({ loans, customers, now: NOW });

    expect(statements.map(s => s.key)).toEqual(['cust-a:QAR', 'cust-a:USDT']);
    expect(statements.map(s => s.outstanding)).toEqual([1000, 250]);
  });

  it('keeps settled buyers, sorted below anyone still owing', () => {
    const loans = [
      loan({ id: 'paid', principal: 900, repayments: [{ id: 'r', ts: at(2026, 7, 2), amount: 900 }] }),
      loan({ id: 'owed', customerId: 'cust-b', principal: 100 }),
    ];

    const statements = buildBuyerStatements({ loans, customers, now: NOW });

    expect(statements.map(s => s.customerId)).toEqual(['cust-b', 'cust-a']);
    const settled = statements[1];
    expect(settled.outstanding).toBe(0);
    expect(settled.settledCount).toBe(1);
    expect(settled.loans[0].settled).toBe(true);
  });

  it('references the linked order when there is one, the loan otherwise', () => {
    const loans = [
      loan({ id: 'from-order', tradeId: 'trade-abc123' }),
      loan({ id: 'standalone-xyz789' }),
    ];

    const [stmt] = buildBuyerStatements({ loans, customers, trades, now: NOW });

    expect(stmt.loans.map(r => r.ref)).toEqual(['ORD-ABC123', 'LN-XYZ789']);
  });

  it('names the account a payment landed in', () => {
    const loans = [loan({ id: 'l1', repayments: [{ id: 'r1', ts: at(2026, 7, 9), amount: 100, accountId: 'acc-1' }] })];

    const [stmt] = buildBuyerStatements({ loans, customers, accounts, now: NOW });

    expect(stmt.entries[1].accountName).toBe('QNB Bank');
  });

  it('ages the outstanding balance by how long each loan has been open', () => {
    const loans = [
      loan({ id: 'fresh', ts: at(2026, 7, 10), principal: 100 }),       // 7 days
      loan({ id: 'mid', ts: at(2026, 6, 1), principal: 200 }),          // 47 days
      loan({ id: 'older', ts: at(2026, 5, 1), principal: 300 }),        // 77 days
      loan({ id: 'ancient', ts: at(2026, 0, 1), principal: 400 }),      // 228 days
      loan({ id: 'settled', ts: at(2026, 0, 1), principal: 500, repayments: [{ id: 'r', ts: at(2026, 1, 1), amount: 500 }] }),
    ];

    const [stmt] = buildBuyerStatements({ loans, customers, now: NOW });

    // A settled loan ages out of the buckets entirely — only debt is aged.
    expect(stmt.aging).toEqual({ current: 100, d31: 200, d61: 300, d90plus: 400 });
    expect(stmt.oldestOpenDays).toBe(228);
  });

  it('reports the last payment across every loan on the account', () => {
    const loans = [
      loan({ id: 'a', repayments: [{ id: 'r1', ts: at(2026, 7, 3), amount: 10 }] }),
      loan({ id: 'b', repayments: [{ id: 'r2', ts: at(2026, 7, 14), amount: 10 }] }),
    ];

    const [stmt] = buildBuyerStatements({ loans, customers, now: NOW });

    expect(stmt.lastPaymentTs).toBe(at(2026, 7, 14));
  });

  it('falls back to the customer id when the customer record is gone', () => {
    const [stmt] = buildBuyerStatements({ loans: [loan({ id: 'l1', customerId: 'ghost' })], customers, now: NOW });
    expect(stmt.customerName).toBe('ghost');
  });
});

describe('totalsByCurrency', () => {
  it('sums each currency separately and counts only the buyers still owing', () => {
    const loans = [
      loan({ id: 'a', principal: 1000, repayments: [{ id: 'r', ts: at(2026, 7, 2), amount: 400 }] }),
      loan({ id: 'b', customerId: 'cust-b', principal: 500, repayments: [{ id: 'r', ts: at(2026, 7, 2), amount: 500 }] }),
      loan({ id: 'c', principal: 200, currency: 'USDT' }),
    ];

    const totals = totalsByCurrency(buildBuyerStatements({ loans, customers, now: NOW }));

    expect(totals).toEqual([
      { currency: 'QAR', loaned: 1500, repaid: 900, outstanding: 600, buyersOwing: 1 },
      { currency: 'USDT', loaned: 200, repaid: 0, outstanding: 200, buyersOwing: 1 },
    ]);
  });
});

describe('statementMatchesQuery', () => {
  const [stmt] = buildBuyerStatements({
    loans: [loan({ id: 'l1', tradeId: 'trade-abc123', note: 'Pays after payday', principal: 4500 })],
    customers,
    trades,
    now: NOW,
  });

  it('matches everything on an empty query', () => {
    expect(statementMatchesQuery(stmt, '  ')).toBe(true);
  });

  it('matches the buyer, the phone, the order ref, the note, and the amount', () => {
    expect(statementMatchesQuery(stmt, 'ahm')).toBe(true);
    expect(statementMatchesQuery(stmt, '5000 1111')).toBe(true);
    expect(statementMatchesQuery(stmt, 'ord-abc')).toBe(true);
    expect(statementMatchesQuery(stmt, 'payday')).toBe(true);
    expect(statementMatchesQuery(stmt, '4500')).toBe(true);
  });

  it('rejects a non-match', () => {
    expect(statementMatchesQuery(stmt, 'zzz')).toBe(false);
  });
});

describe('shortRef', () => {
  it('uppercases the last six alphanumerics', () => {
    expect(shortRef('LN', 'ab12cd34ef')).toBe('LN-CD34EF');
  });

  it('survives an empty id', () => {
    expect(shortRef('LN', '')).toBe('LN-000000');
  });
});
