import { deleteRepayment } from './loanRepayments';
import type { CashLedgerEntry, CustomerLoan } from '../../../lib/tracker-helpers';

export type AcceptResult = { ok: true } | { ok: false; reason: string; rolledBack: boolean };

/**
 * Accepting a payment claim touches two places that cannot share a transaction: the repayments inside the
 * merchant's saved tracker state, and the claim row. This runs them so that either both stand or neither does.
 * The repayments go in first and are confirmed saved; the claim is then confirmed, which the database only
 * allows when it can see those repayments; if that is refused the repayments are taken back out.
 */
export async function acceptClaimAtomically(steps: {
  /** Saves the repayments. Resolves false, or throws, when they could not be saved. */
  apply: () => Promise<boolean>;
  /** Marks the claim accepted. Throws when the claim cannot be accepted. */
  confirm: () => Promise<void>;
  /** Removes the repayments again. Resolves false when that could not be saved either. */
  rollback: () => Promise<boolean>;
}): Promise<AcceptResult> {
  try {
    if (!(await steps.apply())) return { ok: false, reason: 'The repayment could not be saved.', rolledBack: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err), rolledBack: true };
  }
  try {
    await steps.confirm();
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : (err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err));
    let rolledBack = false;
    try { rolledBack = await steps.rollback(); } catch { rolledBack = false; }
    return { ok: false, reason, rolledBack };
  }
}

/** Every repayment carrying `batchId`, and the cash it credited, taken off the books. */
export function removeBatchRepayments(loans: CustomerLoan[], ledger: CashLedgerEntry[], batchId: string): { loans: CustomerLoan[]; ledger: CashLedgerEntry[]; removed: number } {
  let workingLoans = loans;
  let workingLedger = ledger;
  let removed = 0;
  for (const loan of loans) {
    for (const r of loan.repayments || []) {
      if (r.batchId !== batchId) continue;
      const live = workingLoans.find(l => l.id === loan.id) || loan;
      const next = deleteRepayment(live, r.id, workingLedger);
      if (!next) continue;
      workingLoans = workingLoans.map(l => (l.id === live.id ? next.loan : l));
      workingLedger = next.ledger;
      removed += 1;
    }
  }
  return { loans: workingLoans, ledger: workingLedger, removed };
}
