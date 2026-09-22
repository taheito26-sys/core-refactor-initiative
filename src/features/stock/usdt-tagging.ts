// ─── Tagging existing records as USDT borrow / lend movements ───
//
// Pure state transforms behind the Borrow / Lend tab. The merchant never
// types a movement from scratch: they pick a stock batch, an order, or a
// Binance/OKX transfer that is already in the app and say what it really
// was. Each transform returns the next TrackerState (plus any exchange
// transfer ids whose inbox dismissal has to change) and is undone exactly by
// untagTransfer.

import {
  getLoanRepaid,
  resolveCustomerName,
  type TrackerState,
  type Trade,
} from '@/lib/tracker-helpers';
import type { UsdtTransfer, UsdtTransferKind } from '@/lib/usdt-transfers';
import type { ExchangeTransfer } from '@/features/exchanges/types';

export type IncomingKind = 'borrow_in' | 'lend_return';
export type OutgoingKind = 'borrow_repay' | 'lend_out';

export interface TagResult {
  state: TrackerState;
  /** Exchange transfers to hide from (dismiss) or return to (undismiss) the exchange inbox. */
  dismiss?: string[];
  undismiss?: string[];
}

export class TagError extends Error {
  constructor(public code: 'merchant_linked' | 'not_found' | 'already_tagged') {
    super(code);
  }
}

/** Replace-or-append by id — a retag after an undo reuses the same id. */
function upsertTransfer(list: UsdtTransfer[] | undefined, row: UsdtTransfer): UsdtTransfer[] {
  const rest = (list || []).filter(x => x.id !== row.id);
  return [...rest, row];
}

function activeTransfer(state: TrackerState, id: string): UsdtTransfer | undefined {
  return (state.usdtTransfers || []).find(x => x.id === id && !x.voided);
}

/** Display name of the buyer on an order, for prefilling the counterparty. */
export function tradeCounterpartyName(state: TrackerState, trade: Trade, lang: 'en' | 'ar' = 'en'): string {
  const c = (state.customers || []).find(x => x.id === trade.customerId);
  return (c ? resolveCustomerName(c, lang) : '') || trade.exchangeCounterparty || '';
}

/**
 * Orders the merchant can't retag from here: merchant-linked deals and
 * shared orders already approved by a counterparty have their own
 * cancellation flow on the Orders page.
 */
export function isTradeTaggable(trade: Trade): boolean {
  if (trade.linkedDealId || trade.linkedRelId) return false;
  if (trade.approvalStatus === 'approved' || trade.approvalStatus === 'pending_approval' || trade.approvalStatus === 'cancellation_pending') return false;
  return true;
}

/** A stock batch was really USDT borrowed from / returned by another merchant. */
export function tagBatch(
  state: TrackerState,
  batchId: string,
  kind: IncomingKind,
  counterpartyName: string,
  now = Date.now(),
): TagResult {
  const batch = state.batches.find(b => b.id === batchId);
  if (!batch) throw new TagError('not_found');
  if (activeTransfer(state, batchId)) throw new TagError('already_tagged');
  const row: UsdtTransfer = {
    id: batch.id,
    ts: batch.ts,
    kind,
    amountUSDT: batch.initialUSDT,
    counterpartyName: counterpartyName.trim() || batch.source || '',
    // The batch's own price is only a stand-in until a repayment prices it.
    refPriceQAR: batch.buyPriceQAR > 0 ? batch.buyPriceQAR : undefined,
    source: { type: 'batch', id: batch.id },
    createdAt: now,
    updatedAt: now,
  };
  return { state: { ...state, usdtTransfers: upsertTransfer(state.usdtTransfers, row) } };
}

/**
 * An order was really USDT sent back to a lender / lent to a merchant. The
 * order is voided so it stops counting as a sale everywhere, and any unpaid
 * loan the order created is dropped the same way deleting the order would.
 */
export function tagTrade(
  state: TrackerState,
  tradeId: string,
  kind: OutgoingKind,
  counterpartyName: string,
  now = Date.now(),
): TagResult {
  const trade = state.trades.find(t => t.id === tradeId);
  if (!trade || trade.voided) throw new TagError('not_found');
  if (!isTradeTaggable(trade)) throw new TagError('merchant_linked');
  if (activeTransfer(state, tradeId)) throw new TagError('already_tagged');
  const row: UsdtTransfer = {
    id: trade.id,
    ts: trade.ts,
    kind,
    amountUSDT: trade.amountUSDT,
    counterpartyName: counterpartyName.trim() || tradeCounterpartyName(state, trade),
    source: { type: 'trade', id: trade.id },
    createdAt: now,
    updatedAt: now,
  };
  const trades = state.trades.map(t => (t.id === tradeId ? { ...t, voided: true, usdtTransferKind: kind } : t));
  const removedLoanIds = (state.customerLoans || [])
    .filter(l => l.tradeId === tradeId && getLoanRepaid(l) === 0)
    .map(l => l.id);
  const next: TrackerState = { ...state, trades, usdtTransfers: upsertTransfer(state.usdtTransfers, row) };
  if (removedLoanIds.length) {
    next.customerLoans = (state.customerLoans || []).filter(l => !removedLoanIds.includes(l.id));
    next.deletedLoanIds = Array.from(new Set([...(state.deletedLoanIds || []), ...removedLoanIds])).slice(-500);
  }
  return { state: next };
}

/** A Binance/OKX transfer that was never imported was really a borrow/lend movement. */
export function tagExchangeTransfer(
  state: TrackerState,
  transfer: ExchangeTransfer,
  kind: UsdtTransferKind,
  counterpartyName: string,
  id: string,
  now = Date.now(),
): TagResult {
  const row: UsdtTransfer = {
    id,
    ts: transfer.transfer_time ? new Date(transfer.transfer_time).getTime() : now,
    kind,
    amountUSDT: Number(transfer.amount),
    counterpartyName: counterpartyName.trim() || transfer.counterparty || '',
    source: {
      type: 'exchange',
      exchange: transfer.exchange,
      transferIds: [transfer.id],
      reference: transfer.reference,
      preDismissedIds: transfer.dismissed_at ? [transfer.id] : [],
    },
    createdAt: now,
    updatedAt: now,
  };
  return {
    state: { ...state, usdtTransfers: upsertTransfer(state.usdtTransfers, row) },
    dismiss: transfer.dismissed_at ? [] : [transfer.id],
  };
}

/** Undo a tag (or delete a hand-typed movement), restoring whatever it replaced. */
export function untagTransfer(state: TrackerState, transferId: string, now = Date.now()): TagResult {
  const row = (state.usdtTransfers || []).find(x => x.id === transferId);
  if (!row) throw new TagError('not_found');
  const usdtTransfers = (state.usdtTransfers || []).map(x =>
    x.id === transferId ? { ...x, voided: true, updatedAt: now } : x,
  );
  const next: TrackerState = { ...state, usdtTransfers };
  const src = row.source;
  if (src?.type === 'trade') {
    next.trades = state.trades.map(t => {
      if (t.id !== src.id || !t.usdtTransferKind) return t;
      const { usdtTransferKind: _k, ...rest } = t;
      return { ...rest, voided: false };
    });
  }
  if (src?.type === 'exchange') {
    const keep = new Set(src.preDismissedIds || []);
    return { state: next, undismiss: src.transferIds.filter(id => !keep.has(id)) };
  }
  return { state: next };
}
