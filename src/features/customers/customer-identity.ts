import { customerNameVariants, type Customer, type Trade } from '@/lib/tracker-helpers';
import { canonicalizeName } from '@/lib/text-normalize';

/*
 * Customer identity resolution: which portal account (auth user UUID) a
 * merchant-side Customer record is linked to. See
 * docs/customer-identity-lifecycle.md for the full lifecycle.
 *
 * The Customer.id (CUS-...) is the buyer's permanent identity. A link to a
 * portal account is resolved in priority order:
 *   1. Customer.portalUserId, written when the merchant created the login
 *   2. the connection's merchant_customer_id, the server-side copy of 1
 *   3. Customer.id itself being the portal UUID, for a record materialized
 *      from a portal-only buyer on their first order
 *   4. an unambiguous name match, for legacy pairs that predate 1 and 2
 * A link only counts while the connection exists and is not blocked.
 */

export interface PortalConnectionRef {
  customerUserId: string;
  name: string;
  merchantCustomerId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidLike(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

function nameKeys(customer: Pick<Customer, 'name' | 'nameEn' | 'nameAr'>): string[] {
  return customerNameVariants(customer).map(canonicalizeName).filter(Boolean);
}

/**
 * Every customer record that is really the same buyer as `customerId` (same
 * semantics as resolveCustomerIdGroup in the statement edge functions: shared
 * canonical name variant).
 */
export function customerIdGroup(customers: Customer[], customerId: string): Set<string> {
  const group = new Set<string>([customerId]);
  const linked = customers.find(c => c.id === customerId);
  if (!linked) return group;
  const keys = new Set(nameKeys(linked));
  if (keys.size === 0) return group;
  for (const c of customers) {
    if (nameKeys(c).some(k => keys.has(k))) group.add(c.id);
  }
  return group;
}

/** Map of Customer.id → linked portal user id, for every currently linked customer. */
export function resolveCustomerPortalLinks(
  customers: Customer[],
  connections: PortalConnectionRef[],
): Map<string, string> {
  const links = new Map<string, string>();
  const connectedIds = new Set(connections.map(c => c.customerUserId));
  const claimed = new Set<string>();
  const link = (customerId: string, portalUserId: string) => {
    if (links.has(customerId)) return;
    links.set(customerId, portalUserId);
    claimed.add(portalUserId);
  };

  for (const c of customers) {
    if (c.portalUserId && connectedIds.has(c.portalUserId)) link(c.id, c.portalUserId);
  }
  for (const conn of connections) {
    if (!conn.merchantCustomerId) continue;
    if (customers.some(c => c.id === conn.merchantCustomerId)) link(conn.merchantCustomerId, conn.customerUserId);
  }
  for (const c of customers) {
    if (connectedIds.has(c.id)) link(c.id, c.id);
  }

  // Legacy fallback: one portal account and its name match, nothing else
  // with that name on the portal side. Two portal accounts sharing a name
  // are ambiguous and stay unlinked rather than guessed.
  const connectionsByKey = new Map<string, PortalConnectionRef[]>();
  for (const conn of connections) {
    const key = canonicalizeName(conn.name);
    if (!key) continue;
    const bucket = connectionsByKey.get(key);
    if (bucket) bucket.push(conn); else connectionsByKey.set(key, [conn]);
  }
  for (const c of customers) {
    if (links.has(c.id)) continue;
    const matches = new Set<string>();
    let ambiguous = false;
    for (const key of nameKeys(c)) {
      const bucket = connectionsByKey.get(key);
      if (!bucket) continue;
      if (bucket.length > 1) { ambiguous = true; break; }
      matches.add(bucket[0].customerUserId);
    }
    if (ambiguous || matches.size !== 1) continue;
    const [portalUserId] = [...matches];
    // An account already explicitly linked to a different record is not
    // re-claimed by a name lookalike.
    if (claimed.has(portalUserId)) {
      const owners = [...links.entries()].filter(([, p]) => p === portalUserId).map(([id]) => id);
      if (!owners.some(id => customerIdGroup(customers, id).has(c.id))) continue;
    }
    links.set(c.id, portalUserId);
  }

  return links;
}

/** The linked portal account for a customer, considering every record of the same buyer. */
export function resolveCustomerPortalUserId(
  customers: Customer[],
  links: Map<string, string>,
  customerId: string,
): string | null {
  if (!customerId) return null;
  const direct = links.get(customerId);
  if (direct) return direct;
  for (const id of customerIdGroup(customers, customerId)) {
    const portalUserId = links.get(id);
    if (portalUserId) return portalUserId;
  }
  return null;
}

/** Which portal account a trade belongs in, if any. */
export function resolveTradePortalUserId(
  trade: Pick<Trade, 'customerId' | 'connectedCustomerId'>,
  customers: Customer[],
  links: Map<string, string>,
): string | null {
  if (isUuidLike(trade.connectedCustomerId)) return trade.connectedCustomerId as string;
  return resolveCustomerPortalUserId(customers, links, trade.customerId);
}

/** Portal accounts connected to this merchant that no customer record is linked to yet. */
export function unlinkedPortalConnections<T extends PortalConnectionRef>(
  connections: T[],
  links: Map<string, string>,
): T[] {
  const linked = new Set(links.values());
  return connections.filter(c => !linked.has(c.customerUserId));
}

/** Trades and loans recorded under exactly this customer record. */
export function customerHistoryCount(
  state: { trades?: Pick<Trade, 'customerId'>[]; customerLoans?: { customerId: string }[] },
  customerId: string,
): { trades: number; loans: number } {
  return {
    trades: (state.trades ?? []).filter(t => t.customerId === customerId).length,
    loans: (state.customerLoans ?? []).filter(l => l.customerId === customerId).length,
  };
}
