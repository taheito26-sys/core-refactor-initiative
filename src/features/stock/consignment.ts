// ─── USDT consignment: stock sent to another merchant to sell ───
//
// Sending USDT to a merchant who may or may not sell it is neither a sale nor
// a plain loan. It leaves my stock at its FIFO cost (no revenue, no profit),
// is "with the merchant" until they report what happened, and then ends one of
// three ways, in any mix:
//
//  - sold:     a sale at the reported price. Profit is the price over my frozen
//              cost, split by the agreed ratio. It is booked as an order that
//              uses no stock (the send already consumed it) whose fee is the
//              partner's share, so my net is exactly my share.
//  - returned: unsold USDT comes back. It is a lend_return, so stock returns at
//              the cost it left at — no new price, no P&L.
//  - new purchase: the merchant sold, then bought other USDT at another price
//              and sent that. It is an ordinary purchase batch and never
//              settles the consignment.
//
// The consignment itself is the lend_out transfer carrying `consignment`
// metadata, so sync, undo, FIFO and the loan balances all keep working.

import type { Batch, TrackerState, Trade } from '@/lib/tracker-helpers';
import { isTransferActive, type UsdtTransfer } from '@/lib/usdt-transfers';

const EPS = 1e-6;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const round2 = (n: number) => Math.round(n * 100) / 100;

export class ConsignmentError extends Error {
  constructor(public code: 'not_found' | 'bad_amount' | 'exceeds_open' | 'price_below_cost' | 'bad_ratio' | 'duplicate') {
    super(code);
  }
}

export interface ConsignmentSummary {
  id: string;
  counterpartyName: string;
  relationshipId?: string;
  ts: number;
  sent: number;
  sold: number;
  returned: number;
  /** Still with the merchant: sent − sold − returned. */
  open: number;
  profitSharePct: number;
  status: 'open' | 'closed';
}

export function isConsignment(t: UsdtTransfer | undefined): t is UsdtTransfer & { consignment: NonNullable<UsdtTransfer['consignment']> } {
  return !!t && t.kind === 'lend_out' && !!t.consignment;
}

/** Every active consignment with what is sold, returned and still open. */
export function listConsignments(state: Pick<TrackerState, 'usdtTransfers'>): ConsignmentSummary[] {
  const transfers = (state.usdtTransfers || []).filter(isTransferActive);
  return transfers.filter(isConsignment).map(c => {
    const returned = round6(
      transfers.filter(t => t.kind === 'lend_return' && t.consignmentId === c.id).reduce((s, t) => s + Number(t.amountUSDT), 0),
    );
    const sent = Number(c.amountUSDT);
    const sold = round6(Number(c.consignment.soldUSDT) || 0);
    const open = Math.max(0, round6(sent - sold - returned));
    return {
      id: c.id,
      counterpartyName: c.counterpartyName,
      relationshipId: c.relationshipId,
      ts: c.ts,
      sent,
      sold,
      returned,
      open,
      profitSharePct: c.consignment.profitSharePct,
      status: open <= EPS ? 'closed' : 'open',
    };
  }).sort((a, b) => b.ts - a.ts);
}

export function findConsignment(state: Pick<TrackerState, 'usdtTransfers'>, id: string): ConsignmentSummary | undefined {
  return listConsignments(state).find(c => c.id === id);
}

/**
 * Split of one sale. `myShareQAR` is mine of the profit, `partnerShareQAR` is
 * the merchant's, and `remitQAR` is what they hand over: everything they took
 * for the USDT minus their own share. Selling below cost is never valid.
 */
export function splitConsignmentSale(qty: number, priceQAR: number, unitCostQAR: number, mySharePct: number) {
  if (!(qty > 0)) throw new ConsignmentError('bad_amount');
  if (!(mySharePct >= 0 && mySharePct <= 100)) throw new ConsignmentError('bad_ratio');
  if (priceQAR + EPS < unitCostQAR) throw new ConsignmentError('price_below_cost');
  const proceedsQAR = qty * priceQAR;
  const costQAR = qty * unitCostQAR;
  const profitQAR = Math.max(0, proceedsQAR - costQAR);
  const myShareQAR = profitQAR * (mySharePct / 100);
  const partnerShareQAR = profitQAR - myShareQAR;
  return {
    proceedsQAR: round2(proceedsQAR),
    costQAR: round2(costQAR),
    profitQAR: round2(profitQAR),
    myShareQAR: round2(myShareQAR),
    partnerShareQAR: round2(partnerShareQAR),
    remitQAR: round2(proceedsQAR - partnerShareQAR),
  };
}

function replaceTransfer(state: TrackerState, next: UsdtTransfer): TrackerState {
  return { ...state, usdtTransfers: (state.usdtTransfers || []).map(t => (t.id === next.id ? next : t)) };
}

/** USDT leaves stock for another merchant to sell. */
export function sendConsignment(
  state: TrackerState,
  input: { id: string; counterpartyName: string; relationshipId?: string; qty: number; profitSharePct?: number; note?: string; remoteId?: string },
  now = Date.now(),
): TrackerState {
  const qty = round6(input.qty);
  const pct = input.profitSharePct ?? 50;
  if (!(qty > 0)) throw new ConsignmentError('bad_amount');
  if (!(pct >= 0 && pct <= 100)) throw new ConsignmentError('bad_ratio');
  if ((state.usdtTransfers || []).some(t => t.id === input.id)) throw new ConsignmentError('duplicate');
  const row: UsdtTransfer = {
    id: input.id,
    ts: now,
    kind: 'lend_out',
    amountUSDT: qty,
    counterpartyName: input.counterpartyName.trim(),
    relationshipId: input.relationshipId,
    note: input.note,
    consignment: { profitSharePct: pct, soldUSDT: 0, remoteId: input.remoteId },
    createdAt: now,
    updatedAt: now,
  };
  return { ...state, usdtTransfers: [...(state.usdtTransfers || []), row] };
}

/**
 * The merchant sold `qty` at `priceQAR`. `unitCostQAR` is the FIFO cost the
 * USDT left stock at (derived.transferCalc of the send). The order id is
 * stable (`saleId`) so the same report is never booked twice.
 */
export function recordConsignmentSale(
  state: TrackerState,
  input: { consignmentId: string; saleId: string; qty: number; priceQAR: number; unitCostQAR: number; ts?: number },
  now = Date.now(),
): TrackerState {
  if ((state.trades || []).some(t => t.id === input.saleId)) return state;
  const c = findConsignment(state, input.consignmentId);
  const transfer = (state.usdtTransfers || []).find(t => t.id === input.consignmentId);
  if (!c || !isConsignment(transfer)) throw new ConsignmentError('not_found');
  const qty = round6(input.qty);
  if (!(qty > 0)) throw new ConsignmentError('bad_amount');
  if (qty > c.open + EPS) throw new ConsignmentError('exceeds_open');
  const split = splitConsignmentSale(qty, input.priceQAR, input.unitCostQAR, c.profitSharePct);
  const trade: Trade = {
    id: input.saleId,
    ts: input.ts ?? now,
    inputMode: 'USDT',
    amountUSDT: qty,
    sellPriceQAR: input.priceQAR,
    feeQAR: split.partnerShareQAR,
    note: '',
    voided: false,
    usesStock: false,
    revisions: [],
    customerId: '',
    buyerType: 'merchant',
    manualBuyPrice: input.unitCostQAR,
    exchangeCounterparty: c.counterpartyName,
    consignment: { id: c.id, partnerSharePct: 100 - c.profitSharePct, remitQAR: split.remitQAR, remittedQAR: 0 },
  };
  const next = replaceTransfer(state, {
    ...transfer,
    consignment: { ...transfer.consignment, soldUSDT: round6((transfer.consignment.soldUSDT || 0) + qty) },
    updatedAt: now,
  });
  return { ...next, trades: [...(next.trades || []), trade] };
}

/** Unsold USDT comes back: stock is restored at the cost it left at. */
export function recordConsignmentReturn(
  state: TrackerState,
  input: { consignmentId: string; returnId: string; qty: number; ts?: number },
  now = Date.now(),
): TrackerState {
  if ((state.usdtTransfers || []).some(t => t.id === input.returnId)) return state;
  const c = findConsignment(state, input.consignmentId);
  if (!c) throw new ConsignmentError('not_found');
  const qty = round6(input.qty);
  if (!(qty > 0)) throw new ConsignmentError('bad_amount');
  if (qty > c.open + EPS) throw new ConsignmentError('exceeds_open');
  const row: UsdtTransfer = {
    id: input.returnId,
    ts: input.ts ?? now,
    kind: 'lend_return',
    amountUSDT: qty,
    counterpartyName: c.counterpartyName,
    relationshipId: c.relationshipId,
    consignmentId: c.id,
    createdAt: now,
    updatedAt: now,
  };
  return { ...state, usdtTransfers: [...(state.usdtTransfers || []), row] };
}

/**
 * The merchant sold, then bought other USDT and sent that. It is a new
 * purchase at its own price: it never reduces what is open on a consignment.
 */
export function recordConsignmentPurchase(
  state: TrackerState,
  input: { batchId: string; counterpartyName: string; qty: number; priceQAR: number; ts?: number },
  now = Date.now(),
): TrackerState {
  if ((state.batches || []).some(b => b.id === input.batchId)) return state;
  const qty = round6(input.qty);
  if (!(qty > 0) || !(input.priceQAR > 0)) throw new ConsignmentError('bad_amount');
  const batch: Batch = {
    id: input.batchId,
    ts: input.ts ?? now,
    source: input.counterpartyName,
    note: '',
    buyPriceQAR: input.priceQAR,
    initialUSDT: qty,
    revisions: [],
  };
  const withBatch = { ...state, batches: [...(state.batches || []), batch] };
  return settleConsignmentInKind(withBatch, input.counterpartyName, qty * input.priceQAR, 'owner', input.batchId);
}

/**
 * Replacement USDT is paid for out of the sale proceeds, so its cost settles
 * what is owed on this merchant's consignment sales (oldest first) instead of
 * being a second payment. It never edits the sales themselves.
 */
export function settleConsignmentInKind(
  state: TrackerState,
  counterpartyName: string,
  amountQAR: number,
  role: 'owner' | 'receiver',
  eventId: string,
): TrackerState {
  if ((state.trades || []).some(t => t.consignment?.settledBy?.includes(eventId))) return state;
  let left = round2(amountQAR);
  const key = counterpartyName.trim().toLowerCase();
  const trades = [...(state.trades || [])]
    .filter(t => !t.voided && t.consignment && (t.consignment.role || 'owner') === role && (t.exchangeCounterparty || '').trim().toLowerCase() === key)
    .sort((a, b) => a.ts - b.ts);
  const paid = new Map<string, number>();
  for (const t of trades) {
    if (left <= 0) break;
    const open = round2(t.consignment!.remitQAR - t.consignment!.remittedQAR);
    const take = Math.min(open, left);
    if (take > 0) { paid.set(t.id, round2(t.consignment!.remittedQAR + take)); left = round2(left - take); }
  }
  if (paid.size === 0) return state;
  return { ...state, trades: state.trades.map(t => (paid.has(t.id) ? { ...t, consignment: { ...t.consignment!, remittedQAR: paid.get(t.id)!, settledBy: [...(t.consignment!.settledBy || []), eventId] } } : t)) };
}

/** Records that the merchant handed over (part of) the cash for a consignment sale. */
export function recordConsignmentRemittance(state: TrackerState, saleId: string, amountQAR: number): TrackerState {
  const sale = (state.trades || []).find(t => t.id === saleId);
  if (!sale?.consignment) throw new ConsignmentError('not_found');
  if (!(amountQAR > 0)) throw new ConsignmentError('bad_amount');
  const remitted = Math.min(sale.consignment.remitQAR, round2(sale.consignment.remittedQAR + amountQAR));
  return {
    ...state,
    trades: state.trades.map(t => (t.id === saleId ? { ...t, consignment: { ...t.consignment!, remittedQAR: remitted } } : t)),
  };
}

/** Cash still owed per counterparty: owed to me for an owner, owed by me for a receiving merchant. */
export function consignmentReceivables(state: Pick<TrackerState, 'trades'>, role: 'owner' | 'receiver' = 'owner'): { counterpartyName: string; owedQAR: number }[] {
  const map = new Map<string, number>();
  for (const t of state.trades || []) {
    if (t.voided || !t.consignment || (t.consignment.role || 'owner') !== role) continue;
    const name = t.exchangeCounterparty || '';
    map.set(name, (map.get(name) || 0) + (t.consignment.remitQAR - t.consignment.remittedQAR));
  }
  return Array.from(map, ([counterpartyName, owed]) => ({ counterpartyName, owedQAR: round2(owed) })).filter(r => r.owedQAR > 0);
}

/** Undo a sale: voids the order and gives the quantity back to what is open. */
export function undoConsignmentSale(state: TrackerState, saleId: string, now = Date.now()): TrackerState {
  const sale = (state.trades || []).find(t => t.id === saleId);
  if (!sale?.consignment || sale.voided) throw new ConsignmentError('not_found');
  const transfer = (state.usdtTransfers || []).find(t => t.id === sale.consignment!.id);
  if (!isConsignment(transfer)) throw new ConsignmentError('not_found');
  const next = replaceTransfer(state, {
    ...transfer,
    consignment: { ...transfer.consignment, soldUSDT: Math.max(0, round6(transfer.consignment.soldUSDT - sale.amountUSDT)) },
    updatedAt: now,
  });
  return { ...next, trades: next.trades.map(t => (t.id === saleId ? { ...t, voided: true } : t)) };
}

/** Undo a return (or the whole consignment while nothing is sold): voids the transfer. */
export function undoConsignmentTransfer(state: TrackerState, transferId: string, now = Date.now()): TrackerState {
  const t = (state.usdtTransfers || []).find(x => x.id === transferId);
  if (!t) throw new ConsignmentError('not_found');
  if (isConsignment(t)) {
    const hasReturns = (state.usdtTransfers || []).some(x => isTransferActive(x) && x.consignmentId === t.id);
    if ((t.consignment.soldUSDT || 0) > EPS || hasReturns) throw new ConsignmentError('exceeds_open');
  }
  return replaceTransfer(state, { ...t, voided: true, updatedAt: now });
}

/**
 * Receiver's side of a confirmed sale: the merchant sold USDT another
 * merchant sent them. It uses none of their stock (it is not theirs), costs
 * the agreed base price, and the sender's profit share is the fee, so their
 * net is exactly their own share. Booked once per event id.
 */
export function recordReceivedConsignmentSale(
  state: TrackerState,
  input: { saleId: string; consignmentId: string; counterpartyName: string; qty: number; priceQAR: number; basePriceQAR: number; senderSharePct: number; ts?: number },
  now = Date.now(),
): TrackerState {
  if ((state.trades || []).some(t => t.id === input.saleId)) return state;
  const split = splitConsignmentSale(input.qty, input.priceQAR, input.basePriceQAR, input.senderSharePct);
  const trade: Trade = {
    id: input.saleId,
    ts: input.ts ?? now,
    inputMode: 'USDT',
    amountUSDT: round6(input.qty),
    sellPriceQAR: input.priceQAR,
    feeQAR: split.myShareQAR,
    note: '',
    voided: false,
    usesStock: false,
    revisions: [],
    customerId: '',
    buyerType: 'merchant',
    manualBuyPrice: input.basePriceQAR,
    exchangeCounterparty: input.counterpartyName,
    consignment: { id: input.consignmentId, partnerSharePct: input.senderSharePct, remitQAR: split.remitQAR, remittedQAR: 0, role: 'receiver' },
  };
  return { ...state, trades: [...(state.trades || []), trade] };
}
