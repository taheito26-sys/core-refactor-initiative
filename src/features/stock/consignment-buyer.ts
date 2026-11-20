// ─── The merchant on the other side of a consignment is a saved buyer ───
//
// Saving the tracker requires every new order to reference a saved customer
// with a real name (assertSavedOrderBuyers). The orders a consignment books —
// a sale, a shortfall, a network fee — are with the other merchant, so that
// merchant is the buyer. An existing customer is matched by any of its names
// first (see the buyer-identity rules: `name` is never repointed, and one buyer
// must never become two records); one is created only when there is none.

import { isMeaningfulBuyerName, normalizeBuyerName } from '@/lib/buyer-name';
import { customerNameVariants, uid, type Customer, type TrackerState } from '@/lib/tracker-helpers';

const keyOf = (name: string) => normalizeBuyerName(name).toLocaleLowerCase('en');

export function counterpartyCustomer<S extends Pick<TrackerState, 'customers'>>(state: S, counterpartyName: string): { state: S; customerId: string } {
  const wanted = keyOf(counterpartyName);
  const hit = (state.customers || []).find(c => customerNameVariants(c).some(n => keyOf(n) === wanted));
  if (hit) return { state, customerId: hit.id };
  const customer: Customer = {
    id: uid(),
    name: isMeaningfulBuyerName(counterpartyName) ? normalizeBuyerName(counterpartyName) : 'Merchant',
    phone: '',
    tier: 'C',
    dailyLimitUSDT: 0,
    notes: 'Merchant counterparty',
    createdAt: Date.now(),
  };
  return { state: { ...state, customers: [...(state.customers || []), customer] }, customerId: customer.id };
}
