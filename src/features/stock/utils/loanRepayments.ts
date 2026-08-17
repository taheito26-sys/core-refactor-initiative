import {
  getLoanRemaining,
  type CashLedgerEntry,
  type CustomerLoan,
  type LoanRepayment,
} from '@/lib/tracker-helpers';

/**
 * Correcting and removing payments already recorded against a loan.
 *
 * A payment lives in two places: on the loan (what the buyer has paid) and in
 * the cash ledger (where the money landed). Both have to move together, or the
 * statement and the account balances stop agreeing. These helpers keep the pair
 * consistent and re-derive the loan's status, so undoing the payment that
 * settled a loan reopens it.
 */

export interface RepaymentPatch {
  accountId: string;
  amount: number;
  ts: number;
  note?: string;
}

export interface RepaymentResult {
  loan: CustomerLoan;
  ledger: CashLedgerEntry[];
}

/** A loan flagged from what is left owed rather than from what it was before. */
export function withDerivedStatus(loan: CustomerLoan): CustomerLoan {
  return { ...loan, status: getLoanRemaining(loan) <= 0 ? 'closed' : 'open' };
}

export function findRepayment(loan: CustomerLoan, repaymentId: string): LoanRepayment | undefined {
  return (loan.repayments || []).find(r => r.id === repaymentId);
}

/**
 * Apply an edit to one recorded payment, moving its cash row with it.
 *
 * A cash row that is no longer in the ledger — its account was cleared, or a
 * sync dropped it — is deliberately not recreated: resurrecting money someone
 * removed on purpose is worse than leaving the payment without its row.
 *
 * Returns null when the payment isn't on the loan.
 */
export function editRepayment(
  loan: CustomerLoan,
  repaymentId: string,
  patch: RepaymentPatch,
  ledger: CashLedgerEntry[],
  ledgerNote: string,
): RepaymentResult | null {
  const existing = findRepayment(loan, repaymentId);
  if (!existing) return null;

  const { accountId, amount, ts, note } = patch;
  const nextLedger = existing.ledgerEntryId
    ? ledger.map(e => (e.id === existing.ledgerEntryId
      ? { ...e, ts, accountId, amount, currency: loan.currency, note: ledgerNote }
      : e))
    : ledger;

  const nextLoan = withDerivedStatus({
    ...loan,
    repayments: (loan.repayments || []).map(r => (
      r.id === repaymentId ? { ...r, ts, amount, accountId, note } : r
    )),
  });

  return { loan: nextLoan, ledger: nextLedger };
}

/**
 * Drop a payment and the cash row it created. Returns null when the payment
 * isn't on the loan.
 */
export function deleteRepayment(
  loan: CustomerLoan,
  repaymentId: string,
  ledger: CashLedgerEntry[],
): RepaymentResult | null {
  const existing = findRepayment(loan, repaymentId);
  if (!existing) return null;

  return {
    loan: withDerivedStatus({
      ...loan,
      repayments: (loan.repayments || []).filter(r => r.id !== repaymentId),
    }),
    ledger: existing.ledgerEntryId ? ledger.filter(e => e.id !== existing.ledgerEntryId) : ledger,
  };
}
