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
  /** Null/omitted means this payment isn't credited to any cash account. */
  accountId?: string | null;
  amount: number;
  ts: number;
  note?: string;
  /** Id for a newly created cash_ledger row, only used when this edit turns
   * cash-linking on for a payment that didn't have one before. */
  newLedgerEntryId?: string;
}

export interface RepaymentResult {
  loan: CustomerLoan;
  ledger: CashLedgerEntry[];
}

/**
 * A loan flagged from what is left owed rather than from what it was before.
 * Every real mutation to a loan or its repayments funnels through here, so
 * this is also where `updatedAt` gets bumped -- see CustomerLoan.updatedAt
 * and mergeLoansByRecency for why: customerLoans is always merged by id
 * across devices, and a plain union lets a stale device's copy silently
 * overwrite a newer edit just because it saves next.
 */
export function withDerivedStatus(loan: CustomerLoan): CustomerLoan {
  return { ...loan, status: getLoanRemaining(loan) <= 0 ? 'closed' : 'open', updatedAt: Date.now() };
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

  const { accountId, amount, ts, note, newLedgerEntryId } = patch;
  let nextLedger = ledger;
  let nextLedgerEntryId = existing.ledgerEntryId;

  if (accountId) {
    if (existing.ledgerEntryId) {
      // Already cash-linked — move the existing row.
      nextLedger = ledger.map(e => (e.id === existing.ledgerEntryId
        ? { ...e, ts, accountId, amount, currency: loan.currency, note: ledgerNote }
        : e));
    } else if (newLedgerEntryId) {
      // Was recorded with no cash account; this edit turns that on.
      const entry: CashLedgerEntry = {
        id: newLedgerEntryId, ts, type: 'loan_repayment', accountId,
        direction: 'in', amount, currency: loan.currency, note: ledgerNote,
      };
      nextLedger = [...ledger, entry];
      nextLedgerEntryId = entry.id;
    }
  } else if (existing.ledgerEntryId) {
    // This edit turns cash-linking off — drop the row it created.
    nextLedger = ledger.filter(e => e.id !== existing.ledgerEntryId);
    nextLedgerEntryId = undefined;
  }

  const nextLoan = withDerivedStatus({
    ...loan,
    repayments: (loan.repayments || []).map(r => (
      r.id === repaymentId ? { ...r, ts, amount, accountId: accountId || undefined, ledgerEntryId: nextLedgerEntryId, note } : r
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
