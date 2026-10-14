// ─── Money lent to people who are not customers ───
//
// A friend or relative borrows a sum outside of any order. It is entered by
// hand, can be repaid in parts, and counts in the net position as money owed
// to the merchant. It is kept apart from customer loans, which belong to an
// order and show in the customer's portal.

import type { CashLedgerEntry } from '@/lib/tracker-helpers';

export type PersonalLoanCurrency = 'QAR' | 'USD' | 'EGP' | 'USDT';

export interface PersonalLoanRepayment {
  id: string;
  ts: number;
  amount: number;
  note?: string;
  /** The cash ledger entry this repayment was received into, when it went to an account. */
  ledgerEntryId?: string;
}

export interface PersonalLoan {
  id: string;
  person: string;
  principal: number;
  currency: PersonalLoanCurrency;
  /** When the money was handed over. */
  lentAt: number;
  note?: string;
  /** The cash ledger entry the money was handed over from, when it came from an account. */
  ledgerEntryId?: string;
  repayments: PersonalLoanRepayment[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function personalLoanRepaid(loan: Pick<PersonalLoan, 'repayments'>, asOf = Infinity): number {
  return round2((loan.repayments || []).filter(r => r.ts <= asOf).reduce((s, r) => s + (Number(r.amount) || 0), 0));
}

/** What the person still owes at `asOf`; zero before the loan was made. */
export function personalLoanOutstanding(loan: PersonalLoan, asOf = Infinity): number {
  if (loan.lentAt > asOf) return 0;
  return Math.max(0, round2(loan.principal - personalLoanRepaid(loan, asOf)));
}

export interface PersonalRepaymentPatch {
  amount: number;
  ts: number;
  note?: string;
}

export interface PersonalRepaymentResult {
  loan: PersonalLoan;
  ledger: CashLedgerEntry[];
}

/**
 * Correct one recorded repayment. When it was received into a cash account,
 * that ledger row moves with it so balances keep agreeing with the loan. A
 * row that is no longer in the ledger is not recreated. Null when the
 * repayment is not on the loan.
 */
export function editPersonalRepayment(
  loan: PersonalLoan,
  repaymentId: string,
  patch: PersonalRepaymentPatch,
  ledger: CashLedgerEntry[],
): PersonalRepaymentResult | null {
  const existing = (loan.repayments || []).find(r => r.id === repaymentId);
  if (!existing) return null;
  return {
    loan: {
      ...loan,
      repayments: loan.repayments.map(r => (r.id === repaymentId ? { ...r, amount: patch.amount, ts: patch.ts, note: patch.note || undefined } : r)),
    },
    ledger: existing.ledgerEntryId
      ? ledger.map(e => (e.id === existing.ledgerEntryId ? { ...e, amount: patch.amount, ts: patch.ts } : e))
      : ledger,
  };
}

/** Remove one repayment and the cash row it created, which reopens the balance. Null when it is not on the loan. */
export function deletePersonalRepayment(
  loan: PersonalLoan,
  repaymentId: string,
  ledger: CashLedgerEntry[],
): PersonalRepaymentResult | null {
  const existing = (loan.repayments || []).find(r => r.id === repaymentId);
  if (!existing) return null;
  return {
    loan: { ...loan, repayments: loan.repayments.filter(r => r.id !== repaymentId) },
    ledger: existing.ledgerEntryId ? ledger.filter(e => e.id !== existing.ledgerEntryId) : ledger,
  };
}
