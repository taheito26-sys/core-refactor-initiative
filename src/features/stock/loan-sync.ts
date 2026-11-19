// ─── Loan movements shared with a connected merchant ───
//
// A movement with a connected merchant is proposed to them (it shows up in
// their Loans page at once) and booked on both sides. The proposer's copy is
// recorded straight away and carries `remoteLoanId`; the other merchant's
// copy is booked when they approve. A rejection or withdrawal takes the
// proposer's copy back out. Every booking is keyed by the shared id, so
// running it again, or from another device, never books it twice.

import type { TrackerState } from '@/lib/tracker-helpers';
import { applyLoanMove, undoLoanMove, type LoanSource } from './loan-ledger';
import type { TagResult } from './usdt-tagging';

export interface SharedLoanMove {
  id: string;
  direction: 'out' | 'in';
  amountUSDT: number;
  ts: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  iAmProposer: boolean;
  /** The other merchant's display name, from my point of view. */
  counterpartyName: string;
}

const idPrefix = (moveId: string) => `loan:${moveId}:`;

/** Has this shared movement already been booked in this tracker? */
export function isLoanMoveBooked(state: TrackerState, moveId: string): boolean {
  return (state.usdtTransfers || []).some(x => x.id.startsWith(idPrefix(moveId)) || x.remoteLoanId === moveId);
}

/** The responder's copy: the opposite direction of what the proposer recorded. */
export function bookApprovedLoanMove(state: TrackerState, move: SharedLoanMove, now = Date.now()): TagResult {
  if (move.status !== 'approved' || move.iAmProposer || isLoanMoveBooked(state, move.id)) return { state };
  let n = 0;
  const src: LoanSource = { type: 'manual', direction: move.direction === 'out' ? 'in' : 'out', ts: move.ts };
  const r = applyLoanMove(state, src, move.counterpartyName, move.amountUSDT, () => `${idPrefix(move.id)}${n++}`, now);
  return { state: r.state };
}

/** Tag the transfers a proposer just recorded with the shared id (the ones that did not exist before). */
export function tagWithRemoteLoan(before: TrackerState, after: TrackerState, moveId: string): TrackerState {
  const known = new Set((before.usdtTransfers || []).map(x => x.id));
  return {
    ...after,
    usdtTransfers: (after.usdtTransfers || []).map(x => (!known.has(x.id) && !x.remoteLoanId ? { ...x, remoteLoanId: moveId } : x)),
  };
}

/** The proposer's copy of a movement the other merchant rejected, or that was withdrawn, is taken back out. */
export function revertDeclinedLoanMoves(state: TrackerState, moves: SharedLoanMove[], now = Date.now()): TagResult {
  let acc: TagResult = { state };
  const undismiss = new Set<string>();
  const removeOrderLinks: NonNullable<TagResult['removeOrderLinks']> = [];
  for (const m of moves) {
    if (!m.iAmProposer || (m.status !== 'rejected' && m.status !== 'cancelled')) continue;
    for (const x of acc.state.usdtTransfers || []) {
      if (x.remoteLoanId !== m.id || x.voided) continue;
      const r = undoLoanMove(acc.state, x.id, now);
      for (const u of r.undismiss || []) undismiss.add(u);
      removeOrderLinks.push(...(r.removeOrderLinks || []));
      acc = { state: r.state };
    }
  }
  return { state: acc.state, undismiss: Array.from(undismiss), removeOrderLinks };
}
