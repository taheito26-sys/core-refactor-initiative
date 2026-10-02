import {
  uid,
  deriveCashQAR,
  getLoanRepaid,
  type TrackerState,
  type Trade,
  type CustomerLoan,
  type CashCurrency,
  type CashLedgerEntry,
} from '@/lib/tracker-helpers';

export type SplitBlockReason = 'linked_deal' | 'loan_has_repayments';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Whether an existing order can be split at all. A linked partner deal is
 * settled against the whole order on the partner's side, so it cannot be
 * shared out here; a loan that already took repayments would have its
 * history rewritten. Everything else (an open loan, a cash deposit) is
 * pro-rated by `applySplitOffFinancials`.
 */
export function getSplitBlockReason(
  state: Pick<TrackerState, 'customerLoans' | 'deletedLoanIds'>,
  trade: Pick<Trade, 'id' | 'linkedDealId'>,
): SplitBlockReason | null {
  if (trade.linkedDealId) return 'linked_deal';
  const deleted = new Set(state.deletedLoanIds || []);
  const loan = (state.customerLoans || []).find(l => l.tradeId === trade.id && !deleted.has(l.id));
  if (loan && (getLoanRepaid(loan) > 0 || loan.disbursementLedgerEntryId)) return 'loan_has_repayments';
  return null;
}

export interface ApplySplitOffInput {
  /** State that already holds the edited primary trade, its loan and its deposit. */
  nextState: TrackerState;
  secondTrade: Trade;
  /** Whether the order is a loaned order (the primary's loan was kept or created). */
  isLoan: boolean;
  /** Share of the original revenue already deposited in cash, 0..1. */
  depositRatio: number;
  /** Account the original order's proceeds went to, when any were deposited. */
  depositAccount?: Pick<CashLedgerEntry, 'accountId' | 'currency'>;
  currency: CashCurrency;
  loanNote: string;
  depositNote: string;
  now?: number;
  newId?: () => string;
}

/**
 * Gives the split-off trade its own side of the books: a loan for its own
 * amount when the order was loaned, and a cash deposit in the same
 * proportion as the original's. The primary half is expected to have been
 * adjusted by the normal edit path already.
 */
export function applySplitOffFinancials({
  nextState,
  secondTrade,
  isLoan,
  depositRatio,
  depositAccount,
  currency,
  loanNote,
  depositNote,
  now = Date.now(),
  newId = uid,
}: ApplySplitOffInput): TrackerState {
  let state = nextState;

  if (isLoan && secondTrade.customerId) {
    const loan: CustomerLoan = {
      id: newId(),
      ts: secondTrade.ts,
      customerId: secondTrade.customerId,
      tradeId: secondTrade.id,
      principal: Math.max(0, round2(secondTrade.amountUSDT * secondTrade.sellPriceQAR - (secondTrade.feeQAR || 0))),
      currency,
      note: loanNote,
      repayments: [],
      status: 'open',
      createdAt: now,
    };
    state = { ...state, customerLoans: [...(state.customerLoans || []), loan] };
  }

  const deposit = round2(secondTrade.amountUSDT * secondTrade.sellPriceQAR * Math.max(0, Math.min(1, depositRatio)));
  if (deposit > 0 && depositAccount) {
    const entry: CashLedgerEntry = {
      id: newId(),
      ts: now,
      type: 'sale_deposit',
      accountId: depositAccount.accountId,
      direction: 'in',
      amount: deposit,
      currency: depositAccount.currency,
      note: depositNote,
      linkedEntityType: 'trade',
      linkedEntityId: secondTrade.id,
      tradeId: secondTrade.id,
    };
    const ledger = [...(state.cashLedger || []), entry];
    state = { ...state, cashLedger: ledger, cashQAR: deriveCashQAR(state.cashAccounts, ledger) };
  }

  return state;
}
