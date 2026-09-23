import { useMemo } from 'react';
import type { TrackerState } from '@/lib/tracker-helpers';
import { taggedExchangeTransferIds } from '@/lib/usdt-transfers';
import { extractImportedReference } from '@/features/exchanges/tracker-import';
import { useExchangeP2POrders } from '@/features/exchanges/hooks/useExchangeP2POrders';
import { useExchangeTransfers } from '@/features/exchanges/hooks/useExchangeTransfers';
import { useExchangeOrderLinks } from '@/features/exchanges/hooks/useExchangeOrderLinks';
import { findPendingExchangeItems, type PendingExchangeItem } from '@/features/exchanges/reconcile';

/**
 * Every Binance/OKX record that still needs a decision — not yet imported
 * as a sale or purchase, tagged as a merchant loan, or ignored. The single
 * source for both the Loans tab's "Needs a decision" list and the
 * tracker-vs-exchange mismatch check, so the two always agree.
 */
export function usePendingExchangeItems(state: TrackerState): PendingExchangeItem[] {
  const { data: orders } = useExchangeP2POrders();
  const { data: transfers } = useExchangeTransfers();
  const { data: linksByOrder } = useExchangeOrderLinks();
  return useMemo(() => {
    const liveTrades = state.trades.filter((tr) => !tr.voided || tr.usdtTransferKind);
    const liveEntityIds = new Set<string>([
      ...state.batches.map((b) => b.id),
      ...liveTrades.map((tr) => tr.id),
      ...(state.usdtTransfers || []).filter((x) => !x.voided).map((x) => x.id),
    ]);
    const importedReferences = new Set<string>(
      [...state.batches.map((b) => extractImportedReference(b.note)), ...liveTrades.map((tr) => extractImportedReference(tr.note))]
        .filter((r): r is string => !!r),
    );
    return findPendingExchangeItems({
      orders,
      linksByOrder,
      transfers,
      liveEntityIds,
      importedReferences,
      taggedTransferIds: taggedExchangeTransferIds(state.usdtTransfers),
    });
  }, [state.batches, state.trades, state.usdtTransfers, orders, linksByOrder, transfers]);
}
