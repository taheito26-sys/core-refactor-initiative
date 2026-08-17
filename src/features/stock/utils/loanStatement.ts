import {
  getLoanRepaid,
  getLoanRemaining,
  type CashAccount,
  type CashCurrency,
  type Customer,
  type CustomerLoan,
  type Trade,
} from '@/lib/tracker-helpers';

/**
 * Statement of account for a loaned buyer.
 *
 * The loans tab answers "who owes me"; a statement answers "what exactly does
 * this buyer owe me, and how did we get here" — the document that gets sent to
 * the buyer. It is a plain two-column ledger: every loan is a charge (debit),
 * every repayment is a credit, and the running balance after the last row is
 * what is still owed.
 *
 * One statement covers one buyer in one currency. Loans in different currencies
 * never share a balance, so a buyer who took both QAR and USDT credit gets two
 * statements rather than one meaningless sum.
 */

export type StatementEntryKind = 'charge' | 'payment';

export interface StatementEntry {
  id: string;
  ts: number;
  kind: StatementEntryKind;
  /** Reference shown to the buyer — the order ref when the loan came from an order. */
  ref: string;
  /** Charges carry the loan note, payments the payment note. */
  description: string;
  /** Amount added to what the buyer owes (charges only). */
  debit: number;
  /** Amount taken off what the buyer owes (payments only). */
  credit: number;
  /** Balance owed after this row. */
  balance: number;
  /** Cash account a payment landed in, when one was recorded. */
  accountName?: string;
  loanId: string;
}

export interface StatementLoanRow {
  loan: CustomerLoan;
  /** Order ref when the loan is linked to one, otherwise the loan's own ref. */
  ref: string;
  principal: number;
  repaid: number;
  remaining: number;
  paymentCount: number;
  lastPaymentTs: number | null;
  /** Whole days since the loan was issued. */
  ageDays: number;
  settled: boolean;
}

/** Outstanding split by how long it has been owed — the standard AR aging bands. */
export interface StatementAging {
  /** 0–30 days. */
  current: number;
  /** 31–60 days. */
  d31: number;
  /** 61–90 days. */
  d61: number;
  /** Over 90 days. */
  d90plus: number;
}

export interface BuyerStatement {
  /** `${customerId}:${currency}` — stable key for lists and expand state. */
  key: string;
  customerId: string;
  customerName: string;
  phone?: string;
  currency: CashCurrency;
  loans: StatementLoanRow[];
  /** Charges and payments interleaved, oldest first, with a running balance. */
  entries: StatementEntry[];
  totalLoaned: number;
  totalRepaid: number;
  outstanding: number;
  openCount: number;
  settledCount: number;
  firstActivityTs: number;
  lastActivityTs: number;
  lastPaymentTs: number | null;
  /** Age of the oldest loan that still has a balance, in days (0 when all settled). */
  oldestOpenDays: number;
  aging: StatementAging;
}

export interface BuildStatementsInput {
  loans: CustomerLoan[];
  customers: Customer[];
  trades?: Trade[];
  accounts?: CashAccount[];
  now?: number;
}

const DAY_MS = 86400000;

/** Short human reference for a record, e.g. `LN-4F2A9C`. */
export function shortRef(prefix: string, id: string): string {
  const tail = (id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  return `${prefix}-${tail || '000000'}`;
}

/** Whole days between `ts` and `now`, never negative. */
function daysSince(ts: number, now: number): number {
  return Math.max(0, Math.floor((now - ts) / DAY_MS));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Statements for every buyer who has ever been loaned to, biggest debt first.
 *
 * Fully settled buyers are kept — their statement is the receipt proving the
 * account is clear — but they sort below anyone still carrying a balance.
 */
export function buildBuyerStatements({
  loans,
  customers,
  trades = [],
  accounts = [],
  now = Date.now(),
}: BuildStatementsInput): BuyerStatement[] {
  const byKey = new Map<string, CustomerLoan[]>();
  for (const loan of loans) {
    const key = `${loan.customerId}:${loan.currency}`;
    const arr = byKey.get(key);
    if (arr) arr.push(loan); else byKey.set(key, [loan]);
  }

  const accountName = (id?: string) => accounts.find(a => a.id === id)?.name;
  const tradeRef = (tradeId?: string) => {
    if (!tradeId) return undefined;
    const trade = trades.find(tr => tr.id === tradeId);
    return trade ? shortRef('ORD', trade.id) : shortRef('ORD', tradeId);
  };

  const statements = Array.from(byKey.entries()).map(([key, customerLoans]) => {
    const [customerId, currency] = [customerLoans[0].customerId, customerLoans[0].currency];
    const customer = customers.find(c => c.id === customerId);

    const loanRows: StatementLoanRow[] = [...customerLoans]
      .sort((a, b) => a.ts - b.ts)
      .map(loan => {
        const repayments = loan.repayments || [];
        const repaid = getLoanRepaid(loan);
        const remaining = getLoanRemaining(loan);
        const lastPaymentTs = repayments.reduce((max, r) => (r.ts > max ? r.ts : max), 0) || null;
        return {
          loan,
          ref: tradeRef(loan.tradeId) || shortRef('LN', loan.id),
          principal: loan.principal,
          repaid,
          remaining,
          paymentCount: repayments.length,
          lastPaymentTs,
          ageDays: daysSince(loan.ts, now),
          settled: loan.status === 'closed' || remaining <= 0,
        };
      });

    // Charges and payments on one timeline. Ties break charge-before-payment so
    // a same-day loan and repayment never show a negative balance mid-statement.
    const unsorted: Array<Omit<StatementEntry, 'balance'>> = [];
    for (const row of loanRows) {
      unsorted.push({
        id: `charge:${row.loan.id}`,
        ts: row.loan.ts,
        kind: 'charge',
        ref: row.ref,
        description: row.loan.note || '',
        debit: row.principal,
        credit: 0,
        loanId: row.loan.id,
      });
      for (const r of row.loan.repayments || []) {
        unsorted.push({
          id: `payment:${r.id}`,
          ts: r.ts,
          kind: 'payment',
          ref: row.ref,
          description: r.note || '',
          debit: 0,
          credit: Number(r.amount) || 0,
          accountName: accountName(r.accountId),
          loanId: row.loan.id,
        });
      }
    }
    unsorted.sort((a, b) => a.ts - b.ts || (a.kind === b.kind ? 0 : a.kind === 'charge' ? -1 : 1));

    let running = 0;
    const entries: StatementEntry[] = unsorted.map(e => {
      running = round2(running + e.debit - e.credit);
      return { ...e, balance: running };
    });

    const totalLoaned = round2(loanRows.reduce((sum, r) => sum + r.principal, 0));
    const totalRepaid = round2(loanRows.reduce((sum, r) => sum + r.repaid, 0));
    const outstanding = round2(loanRows.reduce((sum, r) => sum + r.remaining, 0));

    const aging: StatementAging = { current: 0, d31: 0, d61: 0, d90plus: 0 };
    for (const row of loanRows) {
      if (row.remaining <= 0) continue;
      const bucket = row.ageDays <= 30 ? 'current' : row.ageDays <= 60 ? 'd31' : row.ageDays <= 90 ? 'd61' : 'd90plus';
      aging[bucket] = round2(aging[bucket] + row.remaining);
    }

    const openRows = loanRows.filter(r => !r.settled);
    const lastPaymentTs = loanRows.reduce<number | null>((max, r) => (
      r.lastPaymentTs != null && (max == null || r.lastPaymentTs > max) ? r.lastPaymentTs : max
    ), null);

    return {
      key,
      customerId,
      customerName: customer?.name || customerId,
      phone: customer?.phone || undefined,
      currency: currency as CashCurrency,
      loans: loanRows,
      entries,
      totalLoaned,
      totalRepaid,
      outstanding,
      openCount: openRows.length,
      settledCount: loanRows.length - openRows.length,
      firstActivityTs: entries[0]?.ts ?? loanRows[0]?.loan.ts ?? now,
      lastActivityTs: entries[entries.length - 1]?.ts ?? loanRows[loanRows.length - 1]?.loan.ts ?? now,
      lastPaymentTs,
      oldestOpenDays: openRows.reduce((max, r) => Math.max(max, r.ageDays), 0),
      aging,
    };
  });

  return statements.sort((a, b) => (
    b.outstanding - a.outstanding
    || b.lastActivityTs - a.lastActivityTs
    || a.customerName.localeCompare(b.customerName)
  ));
}

/** Book-wide totals per currency, for the receivables header. */
export function totalsByCurrency(statements: BuyerStatement[]): Array<{
  currency: CashCurrency;
  loaned: number;
  repaid: number;
  outstanding: number;
  buyersOwing: number;
}> {
  const map = new Map<CashCurrency, { currency: CashCurrency; loaned: number; repaid: number; outstanding: number; buyersOwing: number }>();
  for (const s of statements) {
    const row = map.get(s.currency) || { currency: s.currency, loaned: 0, repaid: 0, outstanding: 0, buyersOwing: 0 };
    row.loaned = round2(row.loaned + s.totalLoaned);
    row.repaid = round2(row.repaid + s.totalRepaid);
    row.outstanding = round2(row.outstanding + s.outstanding);
    if (s.outstanding > 0) row.buyersOwing += 1;
    map.set(s.currency, row);
  }
  return Array.from(map.values()).sort((a, b) => b.outstanding - a.outstanding);
}

/** Case-insensitive match on buyer name, phone, any reference, or any note. */
export function statementMatchesQuery(statement: BuyerStatement, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (statement.customerName.toLowerCase().includes(q)) return true;
  if ((statement.phone || '').toLowerCase().includes(q)) return true;
  if (String(statement.outstanding).includes(q)) return true;
  return statement.loans.some(row => (
    row.ref.toLowerCase().includes(q)
    || (row.loan.note || '').toLowerCase().includes(q)
    || String(row.principal).includes(q)
  ));
}
