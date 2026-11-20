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
//              and sent that. It is an ordinary purchase batch at the new cost.
//              When it was funded from the sale proceeds, its cost is netted
//              against the cash the merchant still owes me, so the owner never
//              counts both the full receivable and the replacement stock.
//
// The consignment itself is the lend_out transfer carrying `consignment`
// metadata, so sync, undo, FIFO and the loan balances all keep working.

import { deriveCashQAR, uid, type Batch, type CashLedgerEntry, type LedgerEntryType, type TrackerState, type Trade } from '@/lib/tracker-helpers';
import { isTransferActive, type UsdtTransfer } from '@/lib/usdt-transfers';
import { voidTransferFees } from './transfer-fee';

const EPS = 1e-6;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const round2 = (n: number) => Math.round(n * 100) / 100;

export class ConsignmentError extends Error {
  constructor(public code: 'not_found' | 'bad_amount' | 'exceeds_open' | 'price_below_cost' | 'bad_ratio' | 'duplicate' | 'insufficient_stock') {
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
  /** USDT both merchants agreed never came back and was not sold. */
  short: number;
  /** Still with the merchant: sent − sold − returned − unaccounted. */
  open: number;
  profitSharePct: number;
  status: 'open' | 'closed';
}

export interface ConsignmentReceivable {
  counterpartyName: string;
  owedQAR: number;
}

export interface ConsignmentPayable {
  counterpartyName: string;
  owedQAR: number;
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
    const short = round6(Number(c.consignment.shortUSDT) || 0);
    const open = Math.max(0, round6(sent - sold - returned - short));
    const status: ConsignmentSummary['status'] = open <= EPS ? 'closed' : 'open';
    return {
      id: c.id,
      counterpartyName: c.counterpartyName,
      relationshipId: c.relationshipId,
      ts: c.ts,
      sent,
      sold,
      returned,
      short,
      open,
      profitSharePct: c.consignment.profitSharePct,
      status,
    };
  }).sort((a, b) => b.ts - a.ts);
}

export function findConsignment(state: Pick<TrackerState, 'usdtTransfers'>, id: string): ConsignmentSummary | undefined {
  return listConsignments(state).find(c => c.id === id);
}

/**
 * Split of one sale. Profit is signed: a loss is shared by the same ratio as
 * a profit. `myShareQAR` is mine, `partnerShareQAR` is the merchant's, and
 * `remitQAR` is what they hand over: proceeds minus their signed share. When
 * the sale is below cost, their share is negative, so they pay the owner the
 * owner's loss share on top of the proceeds.
 */
export function splitConsignmentSale(qty: number, priceQAR: number, unitCostQAR: number, mySharePct: number) {
  if (!(qty > 0)) throw new ConsignmentError('bad_amount');
  if (!(mySharePct >= 0 && mySharePct <= 100)) throw new ConsignmentError('bad_ratio');
  if (!(priceQAR > 0)) throw new ConsignmentError('bad_amount');
  if (!(unitCostQAR > 0)) throw new ConsignmentError('bad_amount');
  const proceedsQAR = qty * priceQAR;
  const costQAR = qty * unitCostQAR;
  const profitQAR = proceedsQAR - costQAR;
  const myShareQAR = profitQAR * (mySharePct / 100);
  const partnerShareQAR = profitQAR - myShareQAR;
  return {
    proceedsQAR: round2(proceedsQAR),
    costQAR: round2(costQAR),
    profitQAR: round2(profitQAR),
    lossQAR: round2(Math.max(0, -profitQAR)),
    myShareQAR: round2(myShareQAR),
    partnerShareQAR: round2(partnerShareQAR),
    remitQAR: round2(proceedsQAR - partnerShareQAR),
  };
}

/** Cash still due on an owner-side sale, after replacement purchases and settlements. */
export function consignmentSaleNetDue(t: Pick<Trade, 'consignment'>): number {
  if (!t.consignment || t.consignment.role === 'receiver') return 0;
  return round2(Math.max(0, t.consignment.remitQAR - (t.consignment.purchaseOffsetQAR || 0) - t.consignment.remittedQAR));
}

/** Cash still held on a receiver-side sale, after replacement purchases and settlements. */
export function consignmentPayableNetDue(t: Pick<Trade, 'consignment'>): number {
  if (!t.consignment || t.consignment.role !== 'receiver') return 0;
  return round2(Math.max(0, (t.consignment.payableQAR || t.consignment.remitQAR) - (t.consignment.purchaseOffsetQAR || 0) - t.consignment.remittedQAR));
}

function replaceTransfer(state: TrackerState, next: UsdtTransfer): TrackerState {
  return { ...state, usdtTransfers: (state.usdtTransfers || []).map(t => (t.id === next.id ? next : t)) };
}

function defaultCashAccountId(state: Pick<TrackerState, 'cashAccounts'>): string | undefined {
  const accounts = (state.cashAccounts || []).filter(a => a.status === 'active' && a.currency === 'QAR');
  // Merchant custody is another merchant's money; the dashboard excludes it
  // from cashQAR, so a consignment settlement must not land there by default.
  return (accounts.find(a => a.type !== 'merchant_custody') ?? accounts[0])?.id;
}

/**
 * The account that received a receiver-side sale's proceeds. New sales store
 * it on the trade; older sales can still be recovered from their cash entry,
 * so later purchases and settlements do not debit a different account.
 */
function receiverProceedsAccountId(state: TrackerState, sale: Trade): string | undefined {
  return sale.consignment?.cashAccountId
    || (state.cashLedger || []).find(e => e.id === `cons-sale-cash-${sale.id}`)?.accountId;
}

/**
 * Pick an active QAR account for a cash movement. If a stored proceeds
 * account has since been deactivated, fall back to another active
 * non-custody account so the movement is still recorded; if there is no
 * active account at all, the caller must reject before changing any debt.
 */
function activeCashAccountId(state: TrackerState, preferred?: string): string | undefined {
  const accounts = (state.cashAccounts || []).filter(a => a.status === 'active' && a.currency === 'QAR');
  return accounts.find(a => a.id === preferred)?.id
    ?? (accounts.find(a => a.type !== 'merchant_custody') ?? accounts[0])?.id;
}

/**
 * Append one immutable cash entry. A supplied `entryId` makes the operation
 * idempotent, which matters because the realtime sync effect can replay a
 * confirmed report after a refresh.
 */
function appendCashEntry(
  state: TrackerState,
  input: {
    entryId?: string;
    accountId?: string;
    direction: 'in' | 'out';
    amount: number;
    type: LedgerEntryType;
    note: string;
    tradeId: string;
    ts?: number;
  },
): TrackerState {
  const amount = round2(input.amount);
  if (!(amount > 0)) return state;
  const entryId = input.entryId || `cons-cash-${uid()}`;
  if ((state.cashLedger || []).some(e => e.id === entryId)) return state;
  const accountId = input.accountId || defaultCashAccountId(state);
  const account = (state.cashAccounts || []).find(a => a.id === accountId && a.status === 'active');
  if (!account) return state;
  const ts = input.ts ?? Date.now();
  const entry: CashLedgerEntry = {
    id: entryId,
    ts,
    type: input.type,
    accountId: account.id,
    direction: input.direction,
    amount,
    currency: account.currency,
    linkedEntityType: 'trade',
    linkedEntityId: input.tradeId,
    tradeId: input.tradeId,
    note: input.note,
  };
  const cashLedger = [...(state.cashLedger || []), entry];
  const cashQAR = deriveCashQAR(state.cashAccounts || [], cashLedger);
  return {
    ...state,
    cashLedger,
    cashQAR,
    cashHistory: [...(state.cashHistory || []), {
      id: `${entryId}-h`,
      ts,
      type: input.direction === 'in' ? 'sale_deposit' : 'withdraw',
      amount,
      balanceAfter: cashQAR,
      owner: state.cashOwner || '',
      bankAccount: account.name,
      note: input.note,
    }],
  };
}

/** USDT leaves stock for another merchant to sell. */
export function sendConsignment(
  state: TrackerState,
  input: { id: string; counterpartyName: string; relationshipId?: string; qty: number; profitSharePct?: number; note?: string; remoteId?: string; /** Take from this batch first instead of the oldest. */ fromBatchId?: string },
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
    ...(input.fromBatchId ? { fromBatchId: input.fromBatchId } : {}),
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
  input: { consignmentId: string; saleId: string; qty: number; priceQAR: number; unitCostQAR: number; ts?: number; /** The ratio the sale was reported under, when it differs from today's. */ profitSharePct?: number; /** The merchant kept the USDT at this price: the whole profit is the owner's. */ buyout?: boolean },
  now = Date.now(),
): TrackerState {
  if ((state.trades || []).some(t => t.id === input.saleId)) return state;
  const c = findConsignment(state, input.consignmentId);
  const transfer = (state.usdtTransfers || []).find(t => t.id === input.consignmentId);
  if (!c || !isConsignment(transfer)) throw new ConsignmentError('not_found');
  const qty = round6(input.qty);
  if (!(qty > 0)) throw new ConsignmentError('bad_amount');
  if (qty > c.open + EPS) throw new ConsignmentError('exceeds_open');
  const sharePct = input.profitSharePct ?? c.profitSharePct;
  const split = splitConsignmentSale(qty, input.priceQAR, input.unitCostQAR, sharePct);
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
    consignment: {
      id: c.id,
      partnerSharePct: 100 - sharePct,
      remitQAR: split.remitQAR,
      remittedQAR: 0,
      purchaseOffsetQAR: 0,
      role: 'owner',
      ...(input.buyout ? { buyout: true } : {}),
    },
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
 * purchase at its own price. If it was funded from the sale proceeds, the
 * cost is netted against that sale's receivable so the owner cannot count
 * both the full cash and the replacement stock.
 */
export function recordConsignmentPurchase(
  state: TrackerState,
  input: { batchId: string; counterpartyName: string; qty: number; priceQAR: number; ts?: number; fundedFromSaleId?: string },
  now = Date.now(),
): TrackerState {
  if ((state.batches || []).some(b => b.id === input.batchId)) return state;
  const qty = round6(input.qty);
  if (!(qty > 0) || !(input.priceQAR > 0)) throw new ConsignmentError('bad_amount');
  const costQAR = round2(qty * input.priceQAR);
  let sale: Trade | undefined;
  if (input.fundedFromSaleId) {
    sale = (state.trades || []).find(t => t.id === input.fundedFromSaleId && t.consignment && !t.voided);
    if (!sale || sale.consignment!.role === 'receiver') throw new ConsignmentError('not_found');
    if (costQAR > consignmentSaleNetDue(sale) + 0.01) throw new ConsignmentError('exceeds_open');
  }
  const batch: Batch = {
    id: input.batchId,
    ts: input.ts ?? now,
    source: input.counterpartyName,
    note: '',
    buyPriceQAR: input.priceQAR,
    initialUSDT: qty,
    revisions: [],
  };
  const withBatch: TrackerState = { ...state, batches: [...(state.batches || []), batch] };
  if (!sale) return withBatch;
  return {
    ...withBatch,
    trades: (withBatch.trades || []).map(t => t.id === sale!.id ? {
      ...t,
      consignment: {
        ...t.consignment!,
        purchaseOffsetQAR: round2((t.consignment!.purchaseOffsetQAR || 0) + costQAR),
      },
    } : t),
  };
}

/**
 * Owner-side settlement: the merchant paid part or all of the cash due.
 * The cash ledger entry is keyed by the settlement id, so replaying a
 * confirmed remote event cannot deposit the same cash twice.
 */
export function recordConsignmentSettlement(
  state: TrackerState,
  input: { saleId: string; amountQAR: number; settlementId?: string; cashAccountId?: string; ts?: number },
): TrackerState {
  const sale = (state.trades || []).find(t => t.id === input.saleId && t.consignment && !t.voided);
  if (!sale || sale.consignment!.role === 'receiver') throw new ConsignmentError('not_found');
  const due = consignmentSaleNetDue(sale);
  const amount = round2(Math.min(input.amountQAR, due));
  if (!(amount > 0)) return state;
  const remitted = round2(sale.consignment!.remittedQAR + amount);
  const entryId = input.settlementId ? `cons-settle-${input.settlementId}` : `cons-settle-${sale.id}-${remitted}`;
  // Check the idempotency key before changing remittedQAR. appendCashEntry
  // also dedupes, but by then the debt has already been reduced again.
  if ((state.cashLedger || []).some(e => e.id === entryId)) return state;
  const accountId = activeCashAccountId(state, input.cashAccountId);
  if (!accountId) throw new ConsignmentError('not_found');
  const next: TrackerState = {
    ...state,
    trades: (state.trades || []).map(t => t.id === sale.id ? {
      ...t,
      consignment: { ...t.consignment!, remittedQAR: remitted },
    } : t),
  };
  return appendCashEntry(next, {
    entryId,
    accountId,
    direction: 'in',
    amount,
    type: 'merchant_settlement_in',
    note: `Consignment cash received from ${sale.exchangeCounterparty || 'merchant'}`,
    tradeId: sale.id,
    ts: input.ts,
  });
}

/** Backwards-compatible name for the owner-side settlement path. */
export function recordConsignmentRemittance(
  state: TrackerState,
  saleId: string,
  amountQAR: number,
  cashAccountId?: string,
): TrackerState {
  return recordConsignmentSettlement(state, { saleId, amountQAR, cashAccountId });
}

/** Cash the merchants still owe me from owner-side consignment sales, per counterparty name. */
export function consignmentReceivables(state: Pick<TrackerState, 'trades'>): ConsignmentReceivable[] {
  const map = new Map<string, number>();
  for (const t of state.trades || []) {
    if (t.voided || !t.consignment || t.consignment.role === 'receiver') continue;
    const name = t.exchangeCounterparty || '';
    map.set(name, (map.get(name) || 0) + consignmentSaleNetDue(t));
  }
  return Array.from(map, ([counterpartyName, owed]) => ({ counterpartyName, owedQAR: round2(owed) })).filter(r => r.owedQAR > 0);
}

/** Cash I am holding for another merchant, from receiver-side consignment sales. */
export function consignmentPayables(state: Pick<TrackerState, 'trades'>): ConsignmentPayable[] {
  const map = new Map<string, number>();
  for (const t of state.trades || []) {
    if ((t.voided && !t.consignment?.buyout) || !t.consignment || t.consignment.role !== 'receiver') continue;
    const name = t.exchangeCounterparty || '';
    map.set(name, (map.get(name) || 0) + consignmentPayableNetDue(t));
  }
  return Array.from(map, ([counterpartyName, owed]) => ({ counterpartyName, owedQAR: round2(owed) })).filter(r => r.owedQAR > 0);
}

/** Undo a sale: voids the order and gives the quantity back to what is open. */
export function undoConsignmentSale(state: TrackerState, saleId: string, now = Date.now()): TrackerState {
  const sale = (state.trades || []).find(t => t.id === saleId);
  if (!sale?.consignment || sale.voided) throw new ConsignmentError('not_found');
  if ((sale.consignment.purchaseOffsetQAR || 0) > EPS || sale.consignment.remittedQAR > EPS) {
    throw new ConsignmentError('exceeds_open');
  }
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
    if ((t.consignment.soldUSDT || 0) > EPS || (t.consignment.shortUSDT || 0) > EPS || hasReturns) throw new ConsignmentError('exceeds_open');
  }
  return voidTransferFees(replaceTransfer(state, { ...t, voided: true, updatedAt: now }), [transferId]);
}

/**
 * Receiver's side of a confirmed sale: the merchant sold USDT another
 * merchant sent them. It uses none of their stock (it is not theirs), costs
 * the agreed base price, and the sender's profit share is the fee, so their
 * net is exactly their own share. The full sale proceeds enter cash, while
 * the owner's share is recorded as a payable until it is settled.
 */
export function recordReceivedConsignmentSale(
  state: TrackerState,
  input: {
    saleId: string;
    consignmentId?: string;
    counterpartyName: string;
    qty: number;
    priceQAR: number;
    basePriceQAR: number;
    senderSharePct: number;
    cashAccountId?: string;
    ts?: number;
  },
  now = Date.now(),
): TrackerState {
  if ((state.trades || []).some(t => t.id === input.saleId)) return state;
  const split = splitConsignmentSale(input.qty, input.priceQAR, input.basePriceQAR, input.senderSharePct);
  const accountId = activeCashAccountId(state, input.cashAccountId);
  if (!accountId) throw new ConsignmentError('not_found');
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
    consignment: {
      id: input.consignmentId || input.saleId,
      partnerSharePct: input.senderSharePct,
      remitQAR: split.remitQAR,
      remittedQAR: 0,
      purchaseOffsetQAR: 0,
      payableQAR: split.remitQAR,
      role: 'receiver',
      purchaseIds: [],
      cashAccountId: accountId,
    },
  };
  const next: TrackerState = { ...state, trades: [...(state.trades || []), trade] };
  return appendCashEntry(next, {
    entryId: `cons-sale-cash-${input.saleId}`,
    accountId,
    direction: 'in',
    amount: round2(input.qty * input.priceQAR),
    type: 'merchant_sale_proceeds',
    note: `Consignment sale proceeds held for ${input.counterpartyName}`,
    tradeId: input.saleId,
    ts: input.ts ?? now,
  });
}

/**
 * Receiver-side replacement purchase: the merchant bought USDT from the
 * market using the owner's sale proceeds. Cash leaves the account and the
 * payable to the owner is reduced by the same cost.
 */
export function recordReceivedConsignmentPurchase(
  state: TrackerState,
  input: {
    purchaseId: string;
    saleId: string;
    counterpartyName: string;
    qty: number;
    priceQAR: number;
    cashAccountId?: string;
    ts?: number;
  },
  now = Date.now(),
): TrackerState {
  const sale = (state.trades || []).find(t => t.id === input.saleId && t.consignment?.role === 'receiver' && !t.voided);
  if (!sale) throw new ConsignmentError('not_found');
  if ((sale.consignment!.purchaseIds || []).includes(input.purchaseId)) return state;
  const qty = round6(input.qty);
  if (!(qty > 0) || !(input.priceQAR > 0)) throw new ConsignmentError('bad_amount');
  const costQAR = round2(qty * input.priceQAR);
  if (costQAR > consignmentPayableNetDue(sale) + 0.01) throw new ConsignmentError('exceeds_open');
  const accountId = activeCashAccountId(state, input.cashAccountId || receiverProceedsAccountId(state, sale));
  if (!accountId) throw new ConsignmentError('not_found');
  const next: TrackerState = {
    ...state,
    trades: (state.trades || []).map(t => t.id === sale.id ? {
      ...t,
      consignment: {
        ...t.consignment!,
        purchaseOffsetQAR: round2((t.consignment!.purchaseOffsetQAR || 0) + costQAR),
        purchaseIds: [...(t.consignment!.purchaseIds || []), input.purchaseId],
      },
    } : t),
  };
  return appendCashEntry(next, {
    entryId: `cons-purchase-cash-${input.purchaseId}`,
    accountId,
    direction: 'out',
    amount: costQAR,
    type: 'stock_purchase',
    note: `Replacement USDT bought from consignment proceeds (${input.counterpartyName})`,
    tradeId: sale.id,
    ts: input.ts ?? now,
  });
}

/**
 * Receiver-side settlement: the merchant paid the owner the remaining cash.
 * Cash leaves the account and the payable is reduced by the same amount.
 */
export function recordReceivedConsignmentSettlement(
  state: TrackerState,
  input: { saleId: string; amountQAR: number; settlementId?: string; cashAccountId?: string; ts?: number },
): TrackerState {
  const sale = (state.trades || []).find(t => t.id === input.saleId && t.consignment?.role === 'receiver' && (!t.voided || t.consignment.buyout));
  if (!sale) throw new ConsignmentError('not_found');
  const due = consignmentPayableNetDue(sale);
  const amount = round2(Math.min(input.amountQAR, due));
  if (!(amount > 0)) return state;
  const paid = round2(sale.consignment!.remittedQAR + amount);
  const entryId = input.settlementId ? `cons-recv-settle-${input.settlementId}` : `cons-recv-settle-${sale.id}-${paid}`;
  if ((state.cashLedger || []).some(e => e.id === entryId)) return state;
  const accountId = activeCashAccountId(state, input.cashAccountId || receiverProceedsAccountId(state, sale));
  if (!accountId) throw new ConsignmentError('not_found');
  const next: TrackerState = {
    ...state,
    trades: (state.trades || []).map(t => t.id === sale.id ? {
      ...t,
      consignment: { ...t.consignment!, remittedQAR: paid },
    } : t),
  };
  return appendCashEntry(next, {
    entryId,
    accountId,
    direction: 'out',
    amount,
    type: 'merchant_settlement_out',
    note: `Consignment cash paid to ${sale.exchangeCounterparty || 'owner'}`,
    tradeId: sale.id,
    ts: input.ts,
  });
}

/**
 * A new profit ratio both merchants agreed to. It applies to sales reported
 * from now on; every sale already booked keeps the ratio it was made under.
 */
export function setConsignmentShare(state: TrackerState, consignmentId: string, profitSharePct: number, now = Date.now()): TrackerState {
  if (!(profitSharePct >= 0 && profitSharePct <= 100)) throw new ConsignmentError('bad_ratio');
  const transfer = (state.usdtTransfers || []).find(t => t.id === consignmentId);
  if (!isConsignment(transfer)) throw new ConsignmentError('not_found');
  if (transfer.consignment.profitSharePct === profitSharePct) return state;
  return replaceTransfer(state, { ...transfer, consignment: { ...transfer.consignment, profitSharePct }, updatedAt: now });
}

/**
 * USDT both merchants agree never came back and was not sold. It stops
 * counting as "with the merchant" and is booked as a loss at the cost it left
 * stock at: an order with no revenue, so it shows in profit and loss as what it
 * is. Booked once per report id.
 */
export function recordConsignmentShortfall(
  state: TrackerState,
  input: { consignmentId: string; shortId: string; qty: number; unitCostQAR: number; ts?: number },
  now = Date.now(),
): TrackerState {
  if ((state.trades || []).some(t => t.id === input.shortId)) return state;
  const c = findConsignment(state, input.consignmentId);
  const transfer = (state.usdtTransfers || []).find(t => t.id === input.consignmentId);
  if (!c || !isConsignment(transfer)) throw new ConsignmentError('not_found');
  const qty = round6(input.qty);
  if (!(qty > 0) || !(input.unitCostQAR > 0)) throw new ConsignmentError('bad_amount');
  if (qty > c.open + EPS) throw new ConsignmentError('exceeds_open');
  const trade: Trade = {
    id: input.shortId,
    ts: input.ts ?? now,
    inputMode: 'USDT',
    amountUSDT: qty,
    sellPriceQAR: 0,
    feeQAR: 0,
    note: 'Consignment shortfall',
    voided: false,
    usesStock: false,
    revisions: [],
    customerId: '',
    buyerType: 'merchant',
    manualBuyPrice: input.unitCostQAR,
    exchangeCounterparty: c.counterpartyName,
    consignment: { id: c.id, partnerSharePct: 100 - c.profitSharePct, remitQAR: 0, remittedQAR: 0, purchaseOffsetQAR: 0, role: 'owner', shortfall: true },
  };
  const next = replaceTransfer(state, {
    ...transfer,
    consignment: { ...transfer.consignment, shortUSDT: round6((transfer.consignment.shortUSDT || 0) + qty) },
    updatedAt: now,
  });
  return { ...next, trades: [...(next.trades || []), trade] };
}

/**
 * Receiver's side of a buy-outright: the merchant kept the USDT at the agreed
 * price. It becomes their stock at that price, and what they owe the owner is
 * carried on a hidden record (it is not a sale, so it never reaches orders or
 * profit) that settlement pays down like any other payable. Booked once.
 */
export function recordReceivedConsignmentBuyout(
  state: TrackerState,
  input: { buyoutId: string; consignmentId: string; counterpartyName: string; qty: number; priceQAR: number; cashAccountId?: string; ts?: number },
  now = Date.now(),
): TrackerState {
  if ((state.trades || []).some(t => t.id === input.buyoutId)) return state;
  const qty = round6(input.qty);
  if (!(qty > 0) || !(input.priceQAR > 0)) throw new ConsignmentError('bad_amount');
  const costQAR = round2(qty * input.priceQAR);
  const accountId = activeCashAccountId(state, input.cashAccountId);
  if (!accountId) throw new ConsignmentError('not_found');
  const batch: Batch = {
    id: input.buyoutId, ts: input.ts ?? now, source: input.counterpartyName, note: 'Consignment bought outright',
    buyPriceQAR: input.priceQAR, initialUSDT: qty, revisions: [],
  };
  const carrier: Trade = {
    id: input.buyoutId, ts: input.ts ?? now, inputMode: 'USDT', amountUSDT: qty, sellPriceQAR: input.priceQAR, feeQAR: 0,
    note: 'Consignment bought outright (payable)', voided: true, usesStock: false, revisions: [], customerId: '',
    buyerType: 'merchant', manualBuyPrice: input.priceQAR, exchangeCounterparty: input.counterpartyName,
    consignment: { id: input.consignmentId, partnerSharePct: 0, remitQAR: costQAR, remittedQAR: 0, purchaseOffsetQAR: 0, payableQAR: costQAR, role: 'receiver', purchaseIds: [], cashAccountId: accountId, buyout: true },
  };
  return { ...state, batches: [...(state.batches || []), batch], trades: [...(state.trades || []), carrier] };
}

/** How long a consignment has been open, in whole days. */
export function consignmentAgeDays(c: Pick<ConsignmentSummary, 'ts'>, now = Date.now()): number {
  return Math.max(0, Math.floor((now - c.ts) / 86_400_000));
}

/** A consignment still holding USDT for longer than this is flagged. */
export const CONSIGNMENT_OVERDUE_DAYS = 7;

/** Open consignments past the overdue threshold, oldest first. */
export function overdueConsignments(state: Pick<TrackerState, 'usdtTransfers'>, now = Date.now(), days = CONSIGNMENT_OVERDUE_DAYS): ConsignmentSummary[] {
  return listConsignments(state).filter(c => c.status === 'open' && consignmentAgeDays(c, now) >= days).sort((a, b) => a.ts - b.ts);
}
