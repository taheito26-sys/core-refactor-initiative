import { describe, expect, it, vi } from 'vitest';
import { acceptClaimAtomically, removeBatchRepayments } from './claimAcceptance';
import type { CashLedgerEntry, CustomerLoan } from '@/lib/tracker-helpers';

const steps = (over: Partial<Parameters<typeof acceptClaimAtomically>[0]> = {}) => ({
  apply: vi.fn(async () => true), confirm: vi.fn(async () => {}), rollback: vi.fn(async () => true), ...over,
});

describe('acceptClaimAtomically', () => {
  it('saves the repayments, then confirms the claim', async () => {
    const s = steps();
    expect(await acceptClaimAtomically(s)).toEqual({ ok: true });
    expect(s.apply.mock.invocationCallOrder[0]).toBeLessThan(s.confirm.mock.invocationCallOrder[0]);
    expect(s.rollback).not.toHaveBeenCalled();
  });

  it('never touches the claim when the repayments could not be saved', async () => {
    const s = steps({ apply: vi.fn(async () => false) });
    const r = await acceptClaimAtomically(s);
    expect(r).toMatchObject({ ok: false, rolledBack: true });
    expect(s.confirm).not.toHaveBeenCalled();
    expect(s.rollback).not.toHaveBeenCalled();
  });

  it('takes the repayments back out when the claim cannot be accepted', async () => {
    const s = steps({ confirm: vi.fn(async () => { throw new Error('This payment claim was already accepted'); }) });
    const r = await acceptClaimAtomically(s);
    expect(r).toEqual({ ok: false, reason: 'This payment claim was already accepted', rolledBack: true });
    expect(s.rollback).toHaveBeenCalledOnce();
  });

  it('reads the reason from a database error that is not an Error', async () => {
    const s = steps({ confirm: vi.fn(async () => { throw { message: 'The repayment for this claim is not saved yet' }; }) });
    expect(await acceptClaimAtomically(s)).toMatchObject({ ok: false, reason: 'The repayment for this claim is not saved yet' });
  });

  it('says so when the undo failed too, so the half-saved payment can be finished instead of repeated', async () => {
    const s = steps({ confirm: vi.fn(async () => { throw new Error('offline'); }), rollback: vi.fn(async () => false) });
    expect(await acceptClaimAtomically(s)).toMatchObject({ ok: false, rolledBack: false });
    const t = steps({ confirm: vi.fn(async () => { throw new Error('offline'); }), rollback: vi.fn(async () => { throw new Error('offline'); }) });
    expect(await acceptClaimAtomically(t)).toMatchObject({ ok: false, rolledBack: false });
  });
});

describe('removeBatchRepayments', () => {
  const loan = (id: string, principal: number, repayments: CustomerLoan['repayments'], status: CustomerLoan['status'] = 'open'): CustomerLoan => ({ id, customerId: 'c', ts: 1, principal, currency: 'QAR', repayments, status, createdAt: 1 });
  const ledger = (id: string): CashLedgerEntry => ({ id, ts: 1, type: 'loan_repayment', accountId: 'a', direction: 'in', amount: 10, currency: 'QAR' });

  it('removes one payment split across loans, with its cash, and reopens a loan it had settled', () => {
    const loans = [
      loan('l1', 100, [{ id: 'r0', ts: 1, amount: 20 }, { id: 'r1', ts: 2, amount: 80, batchId: 'B', ledgerEntryId: 'e1' }], 'closed'),
      loan('l2', 50, [{ id: 'r2', ts: 2, amount: 30, batchId: 'B', ledgerEntryId: 'e2' }]),
    ];
    const out = removeBatchRepayments(loans, [ledger('e1'), ledger('e2'), ledger('keep')], 'B');
    expect(out.removed).toBe(2);
    expect(out.loans[0].repayments?.map(r => r.id)).toEqual(['r0']);
    expect(out.loans[0].status).toBe('open');
    expect(out.loans[1].repayments).toEqual([]);
    expect(out.ledger.map(e => e.id)).toEqual(['keep']);
  });

  it('leaves everything alone when no payment carries that batch', () => {
    const loans = [loan('l1', 100, [{ id: 'r0', ts: 1, amount: 20, batchId: 'OTHER' }])];
    const out = removeBatchRepayments(loans, [], 'B');
    expect(out.removed).toBe(0);
    expect(out.loans).toEqual(loans);
  });
});
