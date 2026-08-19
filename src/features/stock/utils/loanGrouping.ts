import { getLoanRepaid, getLoanRemaining, type CustomerLoan, type CashCurrency, type Customer } from '@/lib/tracker-helpers';

export interface LoanCurrencyTotals {
  given: number;
  received: number;
  remaining: number;
}

export interface ClosedLoanEntry {
  loan: CustomerLoan;
  customer?: Customer;
  /** When the loan was settled — see `getLoanClosedAt`. */
  closedAt: number;
}

export interface ClosedLoanMonthGroup {
  /** `YYYY-MM` in local time — stable id for expand/collapse state. */
  key: string;
  year: number;
  /** 0-indexed, matching `Date#getMonth`. */
  month: number;
  entries: ClosedLoanEntry[];
  totalsByCurrency: Array<[CashCurrency, LoanCurrencyTotals]>;
}

/** A loan counts as closed once it's flagged closed or fully repaid. */
export function isLoanClosed(loan: CustomerLoan): boolean {
  return loan.status === 'closed' || getLoanRemaining(loan) <= 0;
}

/**
 * When a loan was settled: the last repayment that landed on it, falling back
 * to the loan's own date for one closed without any recorded payment (a
 * zero-principal loan, or one closed by an edit).
 */
export function getLoanClosedAt(loan: CustomerLoan): number {
  const last = (loan.repayments || []).reduce((max, r) => (r.ts > max ? r.ts : max), 0);
  return last || loan.ts;
}

/** `YYYY-MM` for a timestamp, in the viewer's local time. */
export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function sumTotals(loans: CustomerLoan[]): Array<[CashCurrency, LoanCurrencyTotals]> {
  const byCurrency = new Map<CashCurrency, LoanCurrencyTotals>();
  for (const l of loans) {
    const totals = byCurrency.get(l.currency) || { given: 0, received: 0, remaining: 0 };
    totals.given += l.principal;
    totals.received += getLoanRepaid(l);
    totals.remaining += getLoanRemaining(l);
    byCurrency.set(l.currency, totals);
  }
  return Array.from(byCurrency.entries());
}

/**
 * Closed loans, grouped by the month they were settled in, newest month first.
 * Within a month, the most recently settled loan comes first.
 */
export function groupClosedLoansByMonth(loans: CustomerLoan[], customers: Customer[]): ClosedLoanMonthGroup[] {
  const byMonth = new Map<string, ClosedLoanEntry[]>();
  for (const loan of loans) {
    if (!isLoanClosed(loan)) continue;
    const closedAt = getLoanClosedAt(loan);
    const key = monthKey(closedAt);
    const entry: ClosedLoanEntry = { loan, customer: customers.find(c => c.id === loan.customerId), closedAt };
    const arr = byMonth.get(key);
    if (arr) arr.push(entry); else byMonth.set(key, [entry]);
  }

  return Array.from(byMonth.entries()).map(([key, entries]) => {
    const sorted = [...entries].sort((a, b) => b.closedAt - a.closedAt);
    const [year, month] = key.split('-').map(Number);
    return {
      key,
      year,
      month: month - 1,
      entries: sorted,
      totalsByCurrency: sumTotals(sorted.map(e => e.loan)),
    };
  }).sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/** Case-insensitive match on customer name, the loan note, or the amount. */
export function loanMatchesQuery(loan: CustomerLoan, customerName: string | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (customerName || '').toLowerCase().includes(q)
    || (loan.note || '').toLowerCase().includes(q)
    || String(loan.principal).includes(q);
}
