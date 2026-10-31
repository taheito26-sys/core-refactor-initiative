import type { ExchangeTransfer } from './types';

// OKX funding-ledger bill types for P2P orders. These two are not transfers at all: 116
// ("Place an order") locks the USDT in escrow when a P2P sell starts, and 118
// ("Cancel an order") releases it back if the order is cancelled.
const OKX_P2P_ESCROW_LOCK = '116';
const OKX_P2P_ESCROW_RELEASE = '118';

const AMOUNT_EPSILON = 1e-8;

/** Marks an exchange_p2p_orders row as one built from an OKX escrow bill rather than reported by OKX. */
export const OKX_ESCROW_SOURCE = 'okx-escrow';

function okxBillType(tr: ExchangeTransfer): string {
  const type = (tr.raw as { type?: unknown } | null | undefined)?.type;
  return type == null ? '' : String(type);
}

function timeOf(tr: ExchangeTransfer): number {
  return tr.transfer_time ? new Date(tr.transfer_time).getTime() : 0;
}

const isOkxBill = (tr: ExchangeTransfer) => tr.exchange === 'okx' && tr.kind !== 'network';

export interface OkxEscrowOrderRow {
  order_number: string;
  side: 'sell';
  asset: string;
  fiat: string;
  amount: number;
  price: number;
  total: number;
  status: string;
  counterparty: string | null;
  order_time: string | null;
  raw: { source: typeof OKX_ESCROW_SOURCE; bill: unknown };
  linked_entity_type: 'batch' | 'trade' | null;
  linked_entity_id: string | null;
  linked_at: string | null;
  dismissed_at: string | null;
}

/**
 * OKX offers no P2P order-history API, so the only trace of a P2P sale is the
 * escrow lock (bill 116) in the funding ledger. Each lock becomes an order of
 * its own, the same shape a Binance order has, with the fiat price and buyer
 * left for the merchant to fill in (OKX does not report either).
 *
 * A cancelled order leaves a lock and a refund (bill 118) of the same size; the
 * lock's order is reported in `cancelledOrderNumbers` so it can be marked
 * cancelled. A lock already linked to the tracker is never treated as cancelled.
 * A row already linked or dismissed keeps that state on its order, so an
 * escrow imported before orders existed is not offered for import a second time.
 */
export function deriveOkxEscrowOrders(transfers: ExchangeTransfer[]): {
  orders: OkxEscrowOrderRow[];
  cancelledOrderNumbers: string[];
} {
  const okx = transfers.filter(isOkxBill);
  const locks = okx.filter((tr) => okxBillType(tr) === OKX_P2P_ESCROW_LOCK).sort((a, b) => timeOf(a) - timeOf(b));
  const releases = okx.filter((tr) => okxBillType(tr) === OKX_P2P_ESCROW_RELEASE).sort((a, b) => timeOf(a) - timeOf(b));

  const cancelledIds = new Set<string>();
  for (const release of releases) {
    // Latest unmatched lock of the same size that happened before the refund.
    const lock = [...locks].reverse().find(
      (candidate) =>
        !candidate.linked_at &&
        !cancelledIds.has(candidate.id) &&
        candidate.asset === release.asset &&
        Math.abs(candidate.amount - release.amount) < AMOUNT_EPSILON &&
        timeOf(candidate) <= timeOf(release),
    );
    if (lock) cancelledIds.add(lock.id);
  }

  return {
    orders: locks.map((lock) => ({
      order_number: lock.reference,
      side: 'sell' as const,
      asset: lock.asset,
      // OKX P2P sells are settled in EGP; the merchant can switch it per order.
      fiat: 'EGP',
      amount: lock.amount,
      price: 0,
      total: 0,
      status: cancelledIds.has(lock.id) ? 'cancelled' : 'completed',
      counterparty: null,
      order_time: lock.transfer_time,
      raw: { source: OKX_ESCROW_SOURCE, bill: lock.raw ?? null },
      linked_entity_type: lock.linked_entity_type,
      linked_entity_id: lock.linked_entity_id,
      linked_at: lock.linked_at,
      dismissed_at: lock.dismissed_at,
    })),
    cancelledOrderNumbers: locks.filter((lock) => cancelledIds.has(lock.id)).map((lock) => lock.reference),
  };
}

/**
 * Sorts what the sync stored as "pay" into what it really is.
 *
 * The sync stores every OKX ledger bill that is not an on-chain deposit or
 * withdrawal as "pay", but OKX has no Binance-Pay-style user-to-user transfer
 * in that ledger. P2P order bills (116/118) are dropped here because they are
 * shown as P2P orders (see deriveOkxEscrowOrders); every other OKX bill is the
 * merchant moving funds between their own accounts and becomes "internal".
 * Only Binance keeps "pay", and on-chain stays "network".
 */
export function normalizeExchangeTransfers(transfers: ExchangeTransfer[]): ExchangeTransfer[] {
  const out: ExchangeTransfer[] = [];
  for (const tr of transfers) {
    if (tr.exchange !== 'okx' || tr.kind !== 'pay') {
      out.push(tr);
      continue;
    }
    const type = okxBillType(tr);
    if (type === OKX_P2P_ESCROW_LOCK || type === OKX_P2P_ESCROW_RELEASE) continue;
    out.push({ ...tr, kind: 'internal' });
  }
  return out;
}
