import type { ExchangeTransfer } from './types';

// OKX funding-ledger bill types for P2P orders. The sync stores every non-deposit,
// non-withdrawal bill as kind "pay", but these two are not transfers at all: 116
// ("Place an order") locks the USDT in escrow when a P2P sell starts, and 118
// ("Cancel an order") releases it back if the order is cancelled.
const OKX_P2P_ESCROW_LOCK = '116';
const OKX_P2P_ESCROW_RELEASE = '118';

const AMOUNT_EPSILON = 1e-8;

function okxBillType(tr: ExchangeTransfer): string {
  const type = (tr.raw as { type?: unknown } | null | undefined)?.type;
  return type == null ? '' : String(type);
}

function timeOf(tr: ExchangeTransfer): number {
  return tr.transfer_time ? new Date(tr.transfer_time).getTime() : 0;
}

/**
 * Tells the four sources apart: Binance/OKX Pay, on-chain network, and OKX P2P.
 *
 * - OKX order bills (116/118) become kind "p2p" instead of "pay".
 * - A cancelled order leaves two bills (escrow out, refund in) that net to zero,
 *   so both are dropped; otherwise the refund looks like incoming stock and the
 *   cancelled escrow looks like a sale. A lock that was already linked to the
 *   tracker is kept so an imported record never disappears from under the user.
 */
export function normalizeExchangeTransfers(transfers: ExchangeTransfer[]): ExchangeTransfer[] {
  const classified = transfers.map((tr) => {
    if (tr.exchange !== 'okx' || tr.kind !== 'pay') return tr;
    const type = okxBillType(tr);
    return type === OKX_P2P_ESCROW_LOCK || type === OKX_P2P_ESCROW_RELEASE ? { ...tr, kind: 'p2p' as const } : tr;
  });

  const locks = classified
    .filter((tr) => tr.exchange === 'okx' && tr.kind === 'p2p' && okxBillType(tr) === OKX_P2P_ESCROW_LOCK && !tr.linked_at)
    .sort((a, b) => timeOf(a) - timeOf(b));
  const releases = classified
    .filter((tr) => tr.exchange === 'okx' && tr.kind === 'p2p' && okxBillType(tr) === OKX_P2P_ESCROW_RELEASE)
    .sort((a, b) => timeOf(a) - timeOf(b));

  const cancelled = new Set<string>();
  for (const release of releases) {
    // Latest unmatched lock of the same size that happened before the refund.
    const lock = [...locks].reverse().find(
      (candidate) =>
        !cancelled.has(candidate.id) &&
        candidate.asset === release.asset &&
        Math.abs(candidate.amount - release.amount) < AMOUNT_EPSILON &&
        timeOf(candidate) <= timeOf(release),
    );
    if (lock) {
      cancelled.add(lock.id);
      cancelled.add(release.id);
    }
  }

  return classified.filter((tr) => !cancelled.has(tr.id));
}
