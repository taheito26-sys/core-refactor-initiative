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
import { taggedAmountBySource, type UsdtTransfer, type UsdtTransferKind } from '@/lib/usdt-transfers';
import type { ExchangeP2POrder, ExchangeTransfer } from '@/features/exchanges/types';

export type IncomingKind = 'borrow_in' | 'lend_return';
export type OutgoingKind = 'borrow_repay' | 'lend_out';

export interface TagResult {
  state: TrackerState;
  /** Exchange transfers to hide from (dismiss) or return to (undismiss) the exchange inbox. */
  dismiss?: string[];
  undismiss?: string[];
  /** Split links to add to / remove from Binance/OKX P2P orders. */
  orderLinks?: { orderId: string; entityType: 'batch' | 'trade'; entityId: string; amount: number; label: string }[];
  removeOrderLinks?: { orderId: string; entityId: string }[];
}

export class TagError extends Error {
  constructor(public code: 'merchant_linked' | 'not_found' | 'already_tagged' | 'bad_amount') {
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

/** Tolerance for "the whole remaining amount" when a tag is typed or rounded. */
const EPS = 1e-6;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** How much of a batch is still a purchase, i.e. not yet tagged as borrowed / returned. */
export function batchUntaggedUSDT(state: TrackerState, batchId: string): number {
  const batch = state.batches.find(b => b.id === batchId);
  if (!batch) return 0;
  const tagged = taggedAmountBySource(state.usdtTransfers, 'batch').get(batchId) || 0;
  return Math.max(0, round6(batch.initialUSDT - tagged));
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

/**
 * All or part of a stock batch was really USDT borrowed from / returned by
 * another merchant. `amountUSDT` defaults to everything still untagged; the
 * rest of the batch stays a normal purchase.
 */
export function tagBatch(
  state: TrackerState,
  batchId: string,
  kind: IncomingKind,
  counterpartyName: string,
  id: string,
  amountUSDT?: number,
  now = Date.now(),
): TagResult {
  const batch = state.batches.find(b => b.id === batchId);
  if (!batch) throw new TagError('not_found');
  if (activeTransfer(state, batchId)) throw new TagError('already_tagged');
  const available = batchUntaggedUSDT(state, batchId);
  const qty = amountUSDT === undefined ? available : round6(amountUSDT);
  if (!(qty > 0) || qty > available + EPS) throw new TagError('bad_amount');
  const row: UsdtTransfer = {
    id,
    ts: batch.ts,
    kind,
    amountUSDT: Math.min(qty, available),
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
 * All or part of an order was really USDT sent back to a lender / lent to a
 * merchant. Tagging the whole order voids it so it stops counting as a sale
 * everywhere, and drops any unpaid loan it created the same way deleting the
 * order would. Tagging part of it shrinks the order to the rest, at the same
 * price, so only that rest still counts as a sale.
 */
export function tagTrade(
  state: TrackerState,
  tradeId: string,
  kind: OutgoingKind,
  counterpartyName: string,
  id: string,
  amountUSDT?: number,
  now = Date.now(),
): TagResult {
  const trade = state.trades.find(t => t.id === tradeId);
  if (!trade || trade.voided) throw new TagError('not_found');
  if (!isTradeTaggable(trade)) throw new TagError('merchant_linked');
  const qty = amountUSDT === undefined ? trade.amountUSDT : round6(amountUSDT);
  if (!(qty > 0) || qty > trade.amountUSDT + EPS) throw new TagError('bad_amount');
  const whole = qty >= trade.amountUSDT - EPS;
  const row: UsdtTransfer = {
    id,
    ts: trade.ts,
    kind,
    amountUSDT: whole ? trade.amountUSDT : qty,
    counterpartyName: counterpartyName.trim() || tradeCounterpartyName(state, trade),
    source: whole ? { type: 'trade', id: trade.id } : { type: 'trade', id: trade.id, partial: true },
    createdAt: now,
    updatedAt: now,
  };
  if (!whole) {
    const trades = state.trades.map(t => (t.id === tradeId ? { ...t, amountUSDT: round6(t.amountUSDT - qty) } : t));
    return { state: { ...state, trades, usdtTransfers: upsertTransfer(state.usdtTransfers, row) } };
  }
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

/**
 * All or part of a Binance/OKX P2P order that was never imported was really
 * a borrow/lend movement — e.g. USDT sent to a lender through P2P. `available`
 * is how much of the order is not yet imported or tagged; the rest of the
 * order stays in the exchange inbox for normal import.
 */
export function tagExchangeOrder(
  state: TrackerState,
  order: ExchangeP2POrder,
  kind: UsdtTransferKind,
  counterpartyName: string,
  id: string,
  available: number,
  amountUSDT?: number,
  now = Date.now(),
): TagResult {
  const incoming = kind === 'borrow_in' || kind === 'lend_return';
  if (incoming !== (order.side === 'buy')) throw new TagError('bad_amount');
  const qty = amountUSDT === undefined ? available : round6(amountUSDT);
  if (!(qty > 0) || qty > available + EPS) throw new TagError('bad_amount');
  const amount = Math.min(qty, available);
  const name = counterpartyName.trim() || order.counterparty || '';
  const row: UsdtTransfer = {
    id,
    ts: order.order_time ? new Date(order.order_time).getTime() : now,
    kind,
    amountUSDT: amount,
    counterpartyName: name,
    source: { type: 'exchange_order', exchange: order.exchange, orderId: order.id, orderNumber: order.order_number, side: order.side },
    createdAt: now,
    updatedAt: now,
  };
  return {
    state: { ...state, usdtTransfers: upsertTransfer(state.usdtTransfers, row) },
    orderLinks: [{ orderId: order.id, entityType: order.side === 'buy' ? 'batch' : 'trade', entityId: id, amount, label: name }],
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
  if (src?.type === 'trade' && !row.voided) {
    next.trades = state.trades.map(t => {
      if (t.id !== src.id) return t;
      // A partial tag took its amount out of the order; give it back.
      if (src.partial) return { ...t, amountUSDT: round6(t.amountUSDT + Number(row.amountUSDT)) };
      if (!t.usdtTransferKind) return t;
      const { usdtTransferKind: _k, ...rest } = t;
      return { ...rest, voided: false };
    });
  }
  if (src?.type === 'exchange_order') {
    return { state: next, removeOrderLinks: [{ orderId: src.orderId, entityId: row.id }] };
  }
  if (src?.type === 'exchange') {
    const keep = new Set(src.preDismissedIds || []);
    return { state: next, undismiss: src.transferIds.filter(id => !keep.has(id)) };
  }
  return { state: next };
}
