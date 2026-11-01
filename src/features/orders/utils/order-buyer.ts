import { isMeaningfulBuyerName } from '@/lib/buyer-name';
import type { Customer, Trade, TrackerState } from '@/lib/tracker-helpers';

export function hasSavedOrderBuyer(customers: Customer[] | undefined, customerId: string | undefined): boolean {
  return !!customerId && !!customers?.some(customer => customer.id === customerId
    && [customer.name, customer.nameEn, customer.nameAr].some(isMeaningfulBuyerName));
}

const orderFields = (trade: Trade) => JSON.stringify([
  trade.ts, trade.customerId, trade.connectedCustomerId, trade.amountUSDT,
  trade.sellPriceQAR, trade.feeQAR, trade.usesStock, trade.note,
]);

/** Every new or corrected order needs a real saved customer. Unchanged legacy rows do not block unrelated work. */
export function assertSavedOrderBuyers(previous: Pick<TrackerState, 'customers' | 'trades'>, next: Pick<TrackerState, 'customers' | 'trades'>): void {
  const before = new Map((previous.trades ?? []).map(trade => [trade.id, trade]));
  for (const trade of next.trades ?? []) {
    // Voided rows are cancellations; capital transfers are not customer orders.
    if (trade.voided || trade.agreementFamily === 'capital_transfer') continue;
    if (hasSavedOrderBuyer(next.customers, trade.customerId)) continue;
    const old = before.get(trade.id);
    if (old && !old.voided && orderFields(old) === orderFields(trade)
      && !hasSavedOrderBuyer(previous.customers, old.customerId)) continue;
    throw new Error('Pick and save a buyer before saving this order.');
  }
}
