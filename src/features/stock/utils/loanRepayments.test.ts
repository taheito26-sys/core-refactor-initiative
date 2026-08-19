import { describe, it, expect } from 'vitest';
import { deleteRepayment, editRepayment, withDerivedStatus } from './loanRepayments';
import type { CashLedgerEntry, CustomerLoan } from '@/lib/tracker-helpers';

const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime();

/** A 1,000 QAR loan half repaid, with the payment's cash row in the ledger. */
function fixture(over: Partial<CustomerLoan> = {}): { loan: CustomerLoan; ledger: CashLedgerEntry[] } {
  const loan: CustomerLoan = {
    id: 'loan-1',
    ts: at(2026, 7, 1),
    customerId: 'cust-a',
    principal: 1000,
    currency: 'QAR',
    status: 'open',
    createdAt: at(2026, 7, 1),
    repayments: [
      { id: 'rep-1', ts: at(2026, 7, 10), amount: 400, accountId: 'acc-1', ledgerEntryId: 'led-1', note: 'cash' },
      { id: 'rep-2', ts: at(2026, 7, 12), amount: 100, accountId: 'acc-1', ledgerEntryId: 'led-2' },
    ],
    ...over,
  };
  const ledger: CashLedgerEntry[] = [
    { id: 'led-0', ts: at(2026, 7, 1), type: 'deposit', accountId: 'acc-1', direction: 'in', amount: 50, currency: 'QAR' },
    { id: 'led-1', ts: at(2026, 7, 10), type: 'loan_repayment', accountId: 'acc-1', direction: 'in', amount: 400, currency: 'QAR', note: 'cash' },
    { id: 'led-2', ts: at(2026, 7, 12), type: 'loan_repayment', accountId: 'acc-1', direction: 'in', amount: 100, currency: 'QAR' },
  ];
  return { loan, ledger };
}

const patch = { accountId: 'acc-2', amount: 250, ts: at(2026, 7, 14), note: 'bank transfer' };

describe('editRepayment', () => {
  it('rewrites the payment and moves its cash row with it', () => {
    const { loan, ledger } = fixture();

    const next = editRepayment(loan, 'rep-1', patch, ledger, 'bank transfer')!;

    expect(next.loan.repayments![0]).toMatchObject({
      id: 'rep-1', amount: 250, accountId: 'acc-2', ts: patch.ts, note: 'bank transfer',
      ledgerEntryId: 'led-1',
    });
    expect(next.ledger.find(e => e.id === 'led-1')).toMatchObject({
      amount: 250, accountId: 'acc-2', ts: patch.ts, note: 'bank transfer', type: 'loan_repayment',
    });
  });

  it('leaves the other payments and unrelated ledger rows alone', () => {
    const { loan, ledger } = fixture();

    const next = editRepayment(loan, 'rep-1', patch, ledger, 'bank transfer')!;

    expect(next.loan.repayments![1]).toEqual(loan.repayments![1]);
    expect(next.ledger.find(e => e.id === 'led-0')).toEqual(ledger[0]);
    expect(next.ledger).toHaveLength(3);
  });

  it('closes the loan when the edit covers the whole principal', () => {
    const { loan, ledger } = fixture();

    const next = editRepayment(loan, 'rep-1', { ...patch, amount: 900 }, ledger, 'note')!;

    expect(next.loan.status).toBe('closed');
  });

  it('reopens a settled loan when the edit no longer covers it', () => {
    const { loan, ledger } = fixture({
      status: 'closed',
      repayments: [{ id: 'rep-1', ts: at(2026, 7, 10), amount: 1000, accountId: 'acc-1', ledgerEntryId: 'led-1' }],
    });

    const next = editRepayment(loan, 'rep-1', { ...patch, amount: 600 }, ledger, 'note')!;

    expect(next.loan.status).toBe('open');
  });

  it('does not resurrect a cash row that is no longer in the ledger', () => {
    const { loan, ledger } = fixture();
    const cleared = ledger.filter(e => e.id !== 'led-1');

    const next = editRepayment(loan, 'rep-1', patch, cleared, 'note')!;

    expect(next.ledger).toEqual(cleared);
    expect(next.loan.repayments![0].amount).toBe(250);
  });

  it('leaves the ledger untouched for a payment that never had a cash row', () => {
    const { loan, ledger } = fixture({
      repayments: [{ id: 'rep-1', ts: at(2026, 7, 10), amount: 400 }],
    });

    const next = editRepayment(loan, 'rep-1', patch, ledger, 'note')!;

    expect(next.ledger).toBe(ledger);
  });

  it('returns null for a payment that is not on the loan', () => {
    const { loan, ledger } = fixture();
    expect(editRepayment(loan, 'nope', patch, ledger, 'note')).toBeNull();
  });
});

describe('deleteRepayment', () => {
  it('drops the payment and the cash it credited', () => {
    const { loan, ledger } = fixture();

    const next = deleteRepayment(loan, 'rep-1', ledger)!;

    expect(next.loan.repayments!.map(r => r.id)).toEqual(['rep-2']);
    expect(next.ledger.map(e => e.id)).toEqual(['led-0', 'led-2']);
  });

  it('reopens a loan the deleted payment had settled', () => {
    const { loan, ledger } = fixture({
      status: 'closed',
      repayments: [{ id: 'rep-1', ts: at(2026, 7, 10), amount: 1000, accountId: 'acc-1', ledgerEntryId: 'led-1' }],
    });

    const next = deleteRepayment(loan, 'rep-1', ledger)!;

    expect(next.loan.status).toBe('open');
    expect(next.loan.repayments).toEqual([]);
  });

  it('keeps the ledger when the payment has no cash row', () => {
    const { loan, ledger } = fixture({ repayments: [{ id: 'rep-1', ts: at(2026, 7, 10), amount: 400 }] });

    const next = deleteRepayment(loan, 'rep-1', ledger)!;

    expect(next.ledger).toBe(ledger);
  });

  it('returns null for a payment that is not on the loan', () => {
    const { loan, ledger } = fixture();
    expect(deleteRepayment(loan, 'nope', ledger)).toBeNull();
  });
});

describe('withDerivedStatus', () => {
  it('flags a loan from what is left owed, not from what it said before', () => {
    const { loan } = fixture({ status: 'closed' });
    expect(withDerivedStatus(loan).status).toBe('open');

    const paid = { ...loan, repayments: [{ id: 'r', ts: 1, amount: 1000 }], status: 'open' as const };
    expect(withDerivedStatus(paid).status).toBe('closed');
  });
});
