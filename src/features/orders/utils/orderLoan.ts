import {
  uid,
  deriveCashQAR,
  getLoanRepaid,
  type TrackerState,
  type CustomerLoan,
  type CashCurrency,
} from '@/lib/tracker-helpers';

/** What the sync did, so the caller can pick a toast (or stay quiet). */
export type OrderLoanOutcome = 'created' | 'updated' | 'removed' | 'unchanged';

export interface SyncOrderLoanInput {
  nextState: TrackerState;
  tradeId: string;
  /** Whether the order should be a loaned order after this edit. */
  isLoan: boolean;
  customerId: string;
  /** Order timestamp — the loan tracks the order's date. */
  ts: number;
  amountUSDT: number;
  sell: number;
  fee: number;
  currency: CashCurrency;
  /** Auto-generated note, e.g. "Loan from order — 14,836 USDT @ 3.80". */
  note: string;
  now?: number;
  newId?: () => string;
}

/** The live (non-tombstoned) loan attached to an order, if any. */
export function findOrderLoan(state: TrackerState, tradeId: string): CustomerLoan | undefined {
  const deleted = new Set(state.deletedLoanIds || []);
  return (state.customerLoans || []).find(l => l.tradeId === tradeId && !deleted.has(l.id));
}

/**
 * Make an order's customer loan match the loaned-order toggle.
 *
 * The loan mirrors the order it came from: principal is the order total net of
 * fee, so correcting qty/price/fee moves the amount owed with it. Un-marking an
 * order removes the loan and reverses any cash it produced.
 *
 * Callers should block un-marking a loan that already has repayments — this
 * function still reverses their ledger entries if it happens, so balances can't
 * drift, but the recorded payments are gone either way.
 */
export function syncOrderLoan({
  nextState,
  tradeId,
  isLoan,
  customerId,
  ts,
  amountUSDT,
  sell,
  fee,
  currency,
  note,
  now = Date.now(),
  newId = uid,
}: SyncOrderLoanInput): { state: TrackerState; outcome: OrderLoanOutcome } {
  const existing = findOrderLoan(nextState, tradeId);
  if (!isLoan && !existing) return { state: nextState, outcome: 'unchanged' };

  const loans = nextState.customerLoans || [];
  const principal = Math.max(0, Math.round((amountUSDT * sell - fee) * 100) / 100);

  if (isLoan && !existing) {
    const loan: CustomerLoan = {
      id: newId(),
      ts,
      customerId,
      tradeId,
      principal,
      currency,
      note,
      repayments: [],
      status: 'open',
      createdAt: now,
    };
    return { state: { ...nextState, customerLoans: [...loans, loan] }, outcome: 'created' };
  }

  if (isLoan && existing) {
    // Only refresh the note while it still looks auto-generated — a note the
    // user typed themselves is theirs to keep.
    const autoNote = !existing.note || /USDT @/.test(existing.note);
    const repaid = getLoanRepaid(existing);
    const updated: CustomerLoan = {
      ...existing,
      ts,
      customerId: customerId || existing.customerId,
      principal,
      note: autoNote ? note : existing.note,
      status: repaid >= principal ? 'closed' : 'open',
    };
    const changed = updated.principal !== existing.principal
      || updated.customerId !== existing.customerId
      || updated.ts !== existing.ts
      || updated.note !== existing.note
      || updated.status !== existing.status;
    if (!changed) return { state: nextState, outcome: 'unchanged' };
    return {
      state: { ...nextState, customerLoans: loans.map(l => (l.id === existing.id ? updated : l)) },
      outcome: 'updated',
    };
  }

  // Un-marked: drop the loan and reverse every cash-side effect it produced.
  const loan = existing!;
  const linkedLedgerIds = new Set(
    [loan.disbursementLedgerEntryId, ...(loan.repayments || []).map(r => r.ledgerEntryId)].filter(Boolean)
  );
  const ledger = nextState.cashLedger || [];
  const nextLedger = linkedLedgerIds.size ? ledger.filter(e => !linkedLedgerIds.has(e.id)) : ledger;
  return {
    state: {
      ...nextState,
      customerLoans: loans.filter(l => l.id !== loan.id),
      // Tombstone the id — a plain removal doesn't survive a cloud merge.
      // See TrackerState.deletedLoanIds.
      deletedLoanIds: Array.from(new Set([...(nextState.deletedLoanIds || []), loan.id])).slice(-500),
      ...(linkedLedgerIds.size
        ? { cashLedger: nextLedger, cashQAR: deriveCashQAR(nextState.cashAccounts, nextLedger) }
        : {}),
    },
    outcome: 'removed',
  };
}
