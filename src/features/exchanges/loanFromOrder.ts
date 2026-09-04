import { uid, type CustomerLoan, type Trade } from '@/lib/tracker-helpers';
import { EXCHANGE_LABELS, type ExchangeP2POrder } from './types';

// Standing QAR conversion rate applied to a Binance sell order when creating
// a buyer loan, until the merchant edits it on the pending-rate row.
export const DEFAULT_QAR_RATE = 3.80;

/**
 * Builds the Trade this exchange order becomes once logged — the "order" the
 * buyer's statement and the Orders page detail view both key off, carrying
 * the exchange's own EGP amount/price/order number/counterparty as real
 * fields (see Trade.originalFiat*) rather than only free text.
 */
export function createTradeForExchangeOrder(
  order: ExchangeP2POrder,
  customerId: string,
  qarRate: number,
): Trade | null {
  if (order.side !== 'sell') return null;
  if (order.status.toUpperCase() !== 'COMPLETED') return null;
  const ts = order.order_time ? new Date(order.order_time).getTime() : Date.now();
  const who = order.counterparty?.trim() || 'unknown counterparty';
  return {
    id: uid(),
    ts,
    inputMode: 'QAR',
    amountUSDT: order.amount,
    sellPriceQAR: qarRate,
    feeQAR: 0,
    note: `Imported from ${EXCHANGE_LABELS[order.exchange]} P2P order ${order.order_number} — counterparty ${who} — ${new Date(ts).toLocaleString()} — sold ${order.amount} USDT for ${order.total} ${order.fiat} (${order.price} ${order.fiat}/USDT)`,
    voided: false,
    usesStock: false,
    revisions: [],
    customerId,
    importedFrom: order.exchange,
    originalFiat: order.fiat,
    originalFiatAmount: order.total,
    originalFiatPriceUSDT: order.price,
    exchangeOrderNumber: order.order_number,
    exchangeCounterparty: order.counterparty ?? undefined,
  };
}

// Builds a CustomerLoan from a completed Binance/OKX P2P sell order. Only a
// completed sell moves USDT out to a customer on credit, so anything else is
// not a loan candidate and this returns null rather than throwing, letting
// callers filter a list of orders without a try/catch per item.
export function createLoanFromExchangeOrder(
  order: ExchangeP2POrder,
  customerId: string,
  qarRate: number,
  tradeId?: string,
): CustomerLoan | null {
  if (order.side !== 'sell') return null;
  if (order.status.toUpperCase() !== 'COMPLETED') return null;
  const principal = Math.round(order.amount * qarRate * 100) / 100;
  const ts = order.order_time ? new Date(order.order_time).getTime() : Date.now();
  return {
    id: uid(),
    ts,
    customerId,
    tradeId,
    principal,
    currency: 'QAR',
    repayments: [],
    status: 'open',
    createdAt: Date.now(),
    qarRate,
    sourceExchange: order.exchange,
    sourceOrderId: order.id,
  };
}

// Completed sell orders that have no linked loan yet — the pending-rate
// queue in Cash Management works off this list.
export function findUnlinkedCompletedSellOrders(
  orders: ExchangeP2POrder[],
  loans: CustomerLoan[],
): ExchangeP2POrder[] {
  const linkedOrderIds = new Set(loans.map(l => l.sourceOrderId).filter(Boolean));
  return orders.filter(o => o.side === 'sell' && o.status.toUpperCase() === 'COMPLETED' && !linkedOrderIds.has(o.id));
}
