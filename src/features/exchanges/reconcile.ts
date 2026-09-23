// ─── Explaining a tracker vs. exchange USDT mismatch ───
//
// The tracker's available stock and the Binance + OKX balances drift apart
// the moment anything happens on an exchange that the tracker hasn't
// recorded yet — most often a P2P order or a transfer still sitting
// unregistered in the exchange inbox. That is not an error in the stock
// batches, so before the mismatch is blamed on them, every unregistered
// exchange record is netted out:
//
//  - a sell order / outgoing transfer already left the exchange but not the
//    tracker, so it makes the tracker look HIGHER (+ its amount);
//  - a buy order / incoming transfer already reached the exchange but not
//    the tracker, so it makes the tracker look LOWER (− its amount).
//
// Whatever is left after that is the real mismatch.

import { sumLinkedAmount, type ExchangeOrderLink } from './hooks/useExchangeOrderLinks';
import type { ExchangeId, ExchangeP2POrder, ExchangeTransfer } from './types';

/** Amounts within this margin are rounding noise from the exchange. */
const AMOUNT_EPSILON = 0.01;

export interface PendingExchangeItem {
  key: string;
  source: 'order' | 'transfer';
  exchange: ExchangeId;
  /** 'sell'/'out' left the exchange; 'buy'/'in' arrived on it. */
  direction: 'out' | 'in';
  ts: number;
  /** USDT of this record not yet registered in the tracker. */
  pendingUSDT: number;
  /** Its share of (tracker − exchange): + for outgoing, − for incoming. */
  effect: number;
  counterparty: string | null;
  /** Exchange order number or transfer reference, for display. */
  reference: string;
  /** P2P only: unit price and fiat, for display. */
  price?: number;
  fiat?: string;
  /** The record itself, so it can be acted on (imported, tagged, ignored). */
  order?: ExchangeP2POrder;
  transfer?: ExchangeTransfer;
}

/**
 * Every exchange record the inbox would still offer for import, with only
 * its unregistered part. Mirrors ExchangeInbox's own coverage rules so the
 * two never disagree on what is "new":
 *
 * - an order counts what its split links (to live entities) already cover,
 *   falling back to its legacy single link or an imported reference;
 * - a transfer is pending unless linked to a live entity, imported by
 *   reference, dismissed as "not an order", or tagged as borrow / lend.
 */
export function findPendingExchangeItems(input: {
  orders: ExchangeP2POrder[] | undefined;
  linksByOrder: Map<string, ExchangeOrderLink[]> | undefined;
  transfers: ExchangeTransfer[] | undefined;
  /** Ids of batches, trades and borrow/lend movements alive in the tracker. */
  liveEntityIds: Set<string>;
  /** Order numbers / transfer references found in live batch/trade notes. */
  importedReferences: Set<string>;
  /** Exchange transfer ids already tagged as borrow / lend movements. */
  taggedTransferIds?: Set<string>;
}): PendingExchangeItem[] {
  const out: PendingExchangeItem[] = [];
  const isUsdt = (asset: string) => String(asset || '').toUpperCase() === 'USDT';

  for (const o of input.orders || []) {
    if (!isUsdt(o.asset)) continue;
    const links = (input.linksByOrder?.get(o.id) ?? []).filter(l => input.liveEntityIds.has(l.entity_id));
    let linked = sumLinkedAmount(links);
    if (linked <= AMOUNT_EPSILON) {
      const legacyLinked = !!o.linked_at && !!o.linked_entity_id && input.liveEntityIds.has(o.linked_entity_id);
      if (legacyLinked || input.importedReferences.has(o.order_number)) linked = Number(o.amount);
    }
    const pending = Math.max(0, Number(o.amount) - linked);
    if (pending <= AMOUNT_EPSILON) continue;
    const direction = o.side === 'sell' ? 'out' : 'in';
    out.push({
      key: `o:${o.id}`,
      source: 'order',
      exchange: o.exchange,
      direction,
      ts: o.order_time ? new Date(o.order_time).getTime() : 0,
      pendingUSDT: pending,
      effect: direction === 'out' ? pending : -pending,
      counterparty: o.counterparty,
      reference: o.order_number,
      price: o.price,
      fiat: o.fiat,
      order: o,
    });
  }

  for (const tr of input.transfers || []) {
    if (!isUsdt(tr.asset) || tr.dismissed_at) continue;
    if (input.taggedTransferIds?.has(tr.id)) continue;
    if (input.importedReferences.has(tr.reference)) continue;
    if (tr.linked_at && (!tr.linked_entity_id || input.liveEntityIds.has(tr.linked_entity_id))) continue;
    const amount = Number(tr.amount);
    if (!(amount > AMOUNT_EPSILON)) continue;
    out.push({
      key: `t:${tr.id}`,
      source: 'transfer',
      exchange: tr.exchange,
      direction: tr.direction,
      ts: tr.transfer_time ? new Date(tr.transfer_time).getTime() : 0,
      pendingUSDT: amount,
      effect: tr.direction === 'out' ? amount : -amount,
      counterparty: tr.counterparty,
      reference: tr.reference,
      transfer: tr,
    });
  }

  return out.sort((a, b) => b.ts - a.ts);
}

export interface DeltaExplanation {
  /** Sum of every pending item's effect: how much of the delta they account for. */
  explained: number;
  /** The mismatch that would still be there once every pending item is registered. */
  remaining: number;
  /** True when registering the pending items would close the gap (within `tolerance`). */
  fullyExplained: boolean;
  items: PendingExchangeItem[];
}

/**
 * Split a tracker − exchange delta into the part unregistered exchange
 * records account for and the part that is a real mismatch. `tolerance`
 * absorbs network withdrawal fees and exchange rounding (about 1 USDT).
 */
export function explainReconciliationDelta(
  delta: number,
  items: PendingExchangeItem[],
  tolerance = 1,
): DeltaExplanation {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const explained = round(items.reduce((sum, i) => sum + i.effect, 0));
  const remaining = round(delta - explained);
  return {
    explained,
    remaining,
    fullyExplained: items.length > 0 && Math.abs(remaining) <= tolerance,
    items,
  };
}
