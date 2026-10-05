// ─── Money lent to people who are not customers ───
//
// A friend or relative borrows a sum outside of any order. It is entered by
// hand, can be repaid in parts, and counts in the net position as money owed
// to the merchant. It is kept apart from customer loans, which belong to an
// order and show in the customer's portal.

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
