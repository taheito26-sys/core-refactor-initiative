// ─── USDT borrow / lend movements between merchants ───
//
// A merchant regularly borrows USDT from another merchant to complete a
// trade, then buys real stock and sends the same amount back — and lends
// USDT out the same way, getting it back later. None of these are sales:
// there is no buyer, no revenue and no profit. Recording them as orders
// (the only option before) put fake revenue on the books, and leaving them
// out entirely left the FIFO stock overstated — the USDT sent back to the
// lender stayed in the batch it was bought in, so the next real sale was
// costed against it and showed a loss that never happened.
//
// These movements feed computeFIFO directly:
//  - borrow_repay / lend_out  — USDT leaves stock, consumed through FIFO
//    exactly like a sale's quantity, but with no revenue and no P&L.
//  - borrow_in / lend_return  — USDT enters stock as a layer at its own
//    timestamp, priced so the round trip is P&L-neutral:
//      lend_return is priced at the FIFO cost of the lent USDT it matches,
//      so the merchant's stock comes back at exactly the cost it left at.
//      borrow_in is priced at the FIFO cost of the repayment it matches —
//      the real USDT bought to pay the lender back is what the borrowed
//      USDT really cost, so a sale made with borrowed USDT carries that
//      cost. Until it is repaid, a borrow is priced at the reference price
//      entered on it, else the nearest real purchase price.

import type { Batch } from './tracker-helpers';

export type UsdtTransferKind = 'borrow_in' | 'borrow_repay' | 'lend_out' | 'lend_return';

/**
 * The record a movement was tagged from, when it was not typed by hand.
 *
 * - batch: all or part of a stock batch was really borrowed / returned
 *   USDT. computeFIFO takes the tagged amount out of the batch's purchase
 *   layer (dropping the batch once all of it is tagged), so voiding the
 *   transfer restores it as a purchase. A tag covering the whole batch
 *   reuses the batch id, so per-batch lookups still find its stock.
 * - trade: all or part of an order was really a repayment / loan-out. A
 *   whole-order tag voids the trade (so it stops counting as a sale
 *   everywhere) and flags it with `usdtTransferKind`; a partial tag
 *   (`partial: true`) instead shrinks the order's amountUSDT by the tagged
 *   amount, and undo adds it back.
 * - exchange: a Binance/OKX Pay or on-chain transfer that was never
 *   imported as a batch or order; it is dismissed from the exchange inbox.
 * - exchange_order: all or part of a Binance/OKX P2P order that was never
 *   imported. The tagged amount is recorded as one of the order's split
 *   links (entity id = this transfer's id), so the exchange inbox counts it
 *   as allocated and only offers the rest for import.
 */
export type UsdtTransferSource =
  | { type: 'batch'; id: string }
  | { type: 'trade'; id: string; partial?: boolean }
  | {
      type: 'exchange';
      exchange: 'binance' | 'okx';
      transferIds: string[];
      reference?: string;
      /** Of transferIds, the ones already dismissed before tagging — left dismissed on undo. */
      preDismissedIds?: string[];
    }
  | { type: 'exchange_order'; exchange: 'binance' | 'okx'; orderId: string; orderNumber: string; side: 'buy' | 'sell' };

export interface UsdtTransfer {
  id: string;
  ts: number;
  kind: UsdtTransferKind;
  amountUSDT: number;
  /** Counterparty merchant display name — also the matching key when no relationship is linked. */
  counterpartyName: string;
  /** Linked merchant relationship, when the counterparty is a connected merchant. */
  relationshipId?: string;
  /**
   * Optional reference price (QAR per USDT) for a borrow_in, used as its
   * cost basis only until a repayment settles it. Ignored for other kinds.
   */
  refPriceQAR?: number;
  note?: string;
  /** Where this movement was tagged from; absent for a hand-typed one. */
  source?: UsdtTransferSource;
  voided?: boolean;
  createdAt: number;
  /** Bumped on every edit/void so cross-device merges keep the latest copy. */
  updatedAt?: number;
}

export function isTransferIn(t: Pick<UsdtTransfer, 'kind'>): boolean {
  return t.kind === 'borrow_in' || t.kind === 'lend_return';
}

export function isTransferActive(t: UsdtTransfer | null | undefined): t is UsdtTransfer {
  return !!t && !t.voided && Number(t.amountUSDT) > 0 && Number.isFinite(Number(t.ts));
}

/** USDT tagged out of each batch (or trade) by active transfers, keyed by source id. */
export function taggedAmountBySource(transfers: UsdtTransfer[] | undefined, type: 'batch' | 'trade'): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of transfers || []) {
    if (isTransferActive(t) && t.source?.type === type) {
      out.set(t.source.id, (out.get(t.source.id) || 0) + Number(t.amountUSDT));
    }
  }
  return out;
}

/** Exchange transfer ids already tagged by an active transfer. */
export function taggedExchangeTransferIds(transfers: UsdtTransfer[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const t of transfers || []) {
    if (isTransferActive(t) && t.source?.type === 'exchange') for (const id of t.source.transferIds) ids.add(id);
  }
  return ids;
}

/** Matching key for pairing a borrow with its repayment (or a loan-out with its return). */
export function transferCounterpartyKey(t: Pick<UsdtTransfer, 'relationshipId' | 'counterpartyName'>): string {
  if (t.relationshipId) return `rel:${t.relationshipId}`;
  return `name:${String(t.counterpartyName || '').trim().toLowerCase()}`;
}

/**
 * Merge two usdtTransfers arrays by id, keeping whichever side's copy of a
 * shared id has the later `updatedAt` — same rationale as
 * mergeLoansByRecency: a stale device must not undo a newer edit or void
 * just because it happens to save next.
 */
export function mergeTransfersByRecency(
  base: UsdtTransfer[] | undefined,
  incoming: UsdtTransfer[] | undefined,
): UsdtTransfer[] {
  const out = new Map<string, UsdtTransfer>();
  for (const t of Array.isArray(base) ? base : []) if (t && t.id) out.set(t.id, t);
  for (const t of Array.isArray(incoming) ? incoming : []) {
    if (!t || !t.id) continue;
    const existing = out.get(t.id);
    if (!existing || (t.updatedAt || 0) >= (existing.updatedAt || 0)) out.set(t.id, t);
  }
  return Array.from(out.values());
}

export interface UsdtTransferBalance {
  key: string;
  counterpartyName: string;
  relationshipId?: string;
  /** Borrowed from them and not yet repaid (USDT I owe them). */
  owedToThem: number;
  /** Lent to them and not yet returned (USDT they owe me). */
  owedToMe: number;
  lastTs: number;
}

/** Outstanding borrow/lend balance per counterparty, active transfers only. */
export function getUsdtTransferBalances(transfers: UsdtTransfer[] | undefined): UsdtTransferBalance[] {
  const map = new Map<string, UsdtTransferBalance>();
  for (const t of transfers || []) {
    if (!isTransferActive(t)) continue;
    const key = transferCounterpartyKey(t);
    const row = map.get(key) || {
      key,
      counterpartyName: t.counterpartyName,
      relationshipId: t.relationshipId,
      owedToThem: 0,
      owedToMe: 0,
      lastTs: 0,
    };
    const qty = Number(t.amountUSDT);
    if (t.kind === 'borrow_in') row.owedToThem += qty;
    else if (t.kind === 'borrow_repay') row.owedToThem -= qty;
    else if (t.kind === 'lend_out') row.owedToMe += qty;
    else if (t.kind === 'lend_return') row.owedToMe -= qty;
    if (t.ts >= row.lastTs) {
      row.lastTs = t.ts;
      if (t.counterpartyName) row.counterpartyName = t.counterpartyName;
    }
    map.set(key, row);
  }
  return Array.from(map.values())
    .map(r => ({
      ...r,
      owedToThem: Math.round(r.owedToThem * 1e6) / 1e6,
      owedToMe: Math.round(r.owedToMe * 1e6) / 1e6,
    }))
    .sort((a, b) => b.lastTs - a.lastTs);
}

/** Nearest real purchase price: latest batch at/before ts, else the earliest one after it. */
export function nearestBatchPrice(batches: Batch[], ts: number): number {
  let before: Batch | null = null;
  let after: Batch | null = null;
  for (const b of batches) {
    if (!(Number(b.buyPriceQAR) > 0)) continue;
    if (b.ts <= ts) {
      if (!before || b.ts >= before.ts) before = b;
    } else if (!after || b.ts < after.ts) {
      after = b;
    }
  }
  return (before || after)?.buyPriceQAR ?? 0;
}

/** Fallback cost basis for an inbound transfer that no outbound one settles yet. */
export function provisionalTransferPrice(t: UsdtTransfer, batches: Batch[]): number {
  if (t.kind === 'borrow_in' && Number(t.refPriceQAR) > 0) return Number(t.refPriceQAR);
  return nearestBatchPrice(batches, t.ts);
}

/** FIFO cost of one outbound transfer, as computed by computeFIFO. */
export interface TransferOutCost {
  coveredQty: number;
  totalCost: number;
}

/**
 * Price every inbound transfer from the outbound transfers it pairs with.
 *
 * Per counterparty, inbound and outbound quantities are matched in time
 * order (first borrowed is first repaid; first lent is first returned).
 * borrow_in pairs with borrow_repay, lend_return pairs with lend_out. The
 * matched part takes the outbound side's FIFO unit cost; any unmatched part
 * takes the provisional price.
 */
export function resolveTransferInPrices(
  transfers: UsdtTransfer[],
  outCosts: Map<string, TransferOutCost>,
  provisional: (t: UsdtTransfer) => number,
): Map<string, number> {
  const prices = new Map<string, number>();
  const groups = new Map<string, { ins: UsdtTransfer[]; outs: UsdtTransfer[] }>();
  for (const t of transfers) {
    const pair = t.kind === 'borrow_in' || t.kind === 'borrow_repay' ? 'borrow' : 'lend';
    const key = `${pair}|${transferCounterpartyKey(t)}`;
    const g = groups.get(key) || { ins: [], outs: [] };
    if (isTransferIn(t)) g.ins.push(t);
    else g.outs.push(t);
    groups.set(key, g);
  }

  const byTs = (a: UsdtTransfer, b: UsdtTransfer) => a.ts - b.ts || a.createdAt - b.createdAt;
  for (const { ins, outs } of groups.values()) {
    ins.sort(byTs);
    outs.sort(byTs);
    const queue = outs.map(o => {
      const c = outCosts.get(o.id);
      const unit = c && c.coveredQty > 0 ? c.totalCost / c.coveredQty : null;
      return { left: Number(o.amountUSDT), unit };
    });
    let qi = 0;
    for (const inT of ins) {
      let need = Number(inT.amountUSDT);
      let matchedQty = 0;
      let matchedCost = 0;
      while (need > 1e-9 && qi < queue.length) {
        const q = queue[qi];
        const take = Math.min(need, q.left);
        if (q.unit !== null) {
          matchedQty += take;
          matchedCost += take * q.unit;
        }
        q.left -= take;
        need -= take;
        if (q.left <= 1e-9) qi += 1;
      }
      const total = Number(inT.amountUSDT);
      const restQty = total - matchedQty;
      const price = total > 0
        ? (matchedCost + restQty * provisional(inT)) / total
        : provisional(inT);
      prices.set(inT.id, price);
    }
  }
  return prices;
}
