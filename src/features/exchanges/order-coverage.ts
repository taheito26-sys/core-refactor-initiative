import type { TrackerState } from '@/lib/tracker-helpers';
import type { ExchangeOrderLink } from './hooks/useExchangeOrderLinks';
import type { ExchangeP2POrder } from './types';
import { isTransferActive } from '@/lib/usdt-transfers';
import { exchangeRegistration } from '@/lib/exchange-registration';

export const exchangeOrderKey = (exchange: string, reference: string) => `${exchange}:${String(reference).trim()}`;

/** Rebuild coverage from durable identities on live tracker rows, independently of link-query timing or editable notes. */
export function trackerOrderAmounts(state: Pick<TrackerState, 'trades' | 'batches'> & Partial<Pick<TrackerState, 'usdtTransfers'>>): Map<string, number> {
  const amounts = new Map<string, number>();
  const add = (row: { note: string; importedFrom?: 'binance' | 'okx'; exchangeOrderNumber?: string; revisions?: Array<{ before?: { note?: string } }> }, amount: number) => {
    const identity = exchangeRegistration(row);
    if (!identity) return;
    const { reference } = identity;
    const exchange = identity.exchange || '*';
    const key = exchangeOrderKey(exchange, reference);
    amounts.set(key, (amounts.get(key) ?? 0) + Math.max(0, Number(amount) || 0));
  };
  for (const trade of new Map((state.trades ?? []).map(t => [t.id, t])).values()) {
    if (!trade.voided || trade.usdtTransferKind) add(trade, trade.amountUSDT);
  }
  for (const batch of new Map((state.batches ?? []).map(b => [b.id, b])).values()) add(batch, batch.initialUSDT);
  for (const movement of new Map((state.usdtTransfers ?? []).map(row => [row.id, row])).values()) {
    if (isTransferActive(movement) && movement.source?.type === 'exchange_order') {
      add({ note: '', importedFrom: movement.source.exchange, exchangeOrderNumber: movement.source.orderNumber }, movement.amountUSDT + Math.max(0, Number(movement.feeUSDT) || 0));
    }
  }
  return amounts;
}

/** Shared by the P2P audit, inbox and exchange-balance reconciliation. */
export function registeredOrderAmount(order: ExchangeP2POrder, input: {
  linksByOrder?: Map<string, ExchangeOrderLink[]>;
  liveEntityIds?: Set<string>;
  importedReferences?: Set<string>;
  trackerAmounts?: Map<string, number>;
}): number {
  const recorded = input.trackerAmounts?.get(exchangeOrderKey(order.exchange, order.order_number))
    ?? input.trackerAmounts?.get(exchangeOrderKey('*', order.order_number));
  if (recorded != null) return recorded;
  const linked = (input.linksByOrder?.get(order.id) ?? [])
    .filter(link => !input.liveEntityIds || input.liveEntityIds.has(link.entity_id))
    .reduce((sum, link) => sum + (Number(link.allocated_amount) || 0), 0);
  if (linked > 0.01) return linked;
  const liveLegacyLink = !!order.linked_at && (!input.liveEntityIds || (!!order.linked_entity_id && input.liveEntityIds.has(order.linked_entity_id)));
  // A supplied tracker index already covers legacy note references and scopes known sources by exchange.
  const legacyReference = !input.trackerAmounts && input.importedReferences?.has(order.order_number);
  return liveLegacyLink || legacyReference ? Number(order.amount) : 0;
}
