import { describe, expect, it } from 'vitest';
import type { TrackerState } from '@/lib/tracker-helpers';
import { merchantNet, applyLoanMove } from '@/features/stock/loan-ledger';
import { bookApprovedLoanMove, revertDeclinedLoanMoves, tagWithRemoteLoan, type SharedLoanMove } from '@/features/stock/loan-sync';

const empty = () => ({ batches: [], trades: [], usdtTransfers: [] }) as unknown as TrackerState;
const move = (over: Partial<SharedLoanMove> = {}): SharedLoanMove => ({
  id: 'm1', direction: 'out', amountUSDT: 10000, ts: 5, status: 'approved', iAmProposer: false, counterpartyName: 'Mohamed Abdelazim', ...over,
});

describe('loan movements shared with a connected merchant', () => {
  it('the merchant who sent USDT lends; the receiver books it as a borrowing from them', () => {
    const r = bookApprovedLoanMove(empty(), move());
    expect(r.state.usdtTransfers).toHaveLength(1);
    expect(r.state.usdtTransfers![0]).toMatchObject({ kind: 'borrow_in', amountUSDT: 10000, counterpartyName: 'Mohamed Abdelazim' });
    expect(merchantNet(r.state.usdtTransfers, 'Mohamed Abdelazim')).toBe(10000); // I owe them
  });

  it('is booked once however many times it is applied', () => {
    const once = bookApprovedLoanMove(empty(), move()).state;
    const twice = bookApprovedLoanMove(once, move()).state;
    expect(twice.usdtTransfers).toHaveLength(1);
  });

  it('is not booked while pending, rejected, or by the proposer', () => {
    expect(bookApprovedLoanMove(empty(), move({ status: 'pending' })).state.usdtTransfers).toHaveLength(0);
    expect(bookApprovedLoanMove(empty(), move({ status: 'rejected' })).state.usdtTransfers).toHaveLength(0);
    expect(bookApprovedLoanMove(empty(), move({ iAmProposer: true })).state.usdtTransfers).toHaveLength(0);
  });

  it('an incoming movement against an existing debt is a return plus the excess', () => {
    // I lent him 4,000; he sends back 6,000 (proposer direction out → my side in).
    const lent = applyLoanMove(empty(), { type: 'manual', direction: 'out', ts: 1 }, 'Zack', 4000, (() => { let i = 0; return () => `x${i++}`; })()).state;
    const r = bookApprovedLoanMove(lent, move({ amountUSDT: 6000, counterpartyName: 'Zack' }));
    expect(r.state.usdtTransfers!.map((x) => [x.kind, x.amountUSDT])).toEqual([['lend_out', 4000], ['lend_return', 4000], ['borrow_in', 2000]]);
  });

  it('a rejected proposal takes the proposer copy back out', () => {
    const before = empty();
    const after = tagWithRemoteLoan(before, applyLoanMove(before, { type: 'manual', direction: 'out', ts: 1 }, 'Farida', 500, () => 't1').state, 'm9');
    expect(after.usdtTransfers![0].remoteLoanId).toBe('m9');
    const r = revertDeclinedLoanMoves(after, [move({ id: 'm9', iAmProposer: true, status: 'rejected' })]);
    expect(r.state.usdtTransfers!.every((x) => x.voided)).toBe(true);
    expect(merchantNet(r.state.usdtTransfers, 'Farida')).toBe(0);
  });
});
