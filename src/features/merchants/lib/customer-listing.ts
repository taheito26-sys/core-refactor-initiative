import type { Customer } from '@/lib/tracker-helpers';
import { resolveCustomerLabel } from '@/features/merchants/lib/customer-labels';

export type ConnectedCustomerRow = {
  id: string;
  name: string;
  phone: string;
  tier: string;
  dailyLimitUSDT: number;
  notes: string;
  createdAt: number;
  source: 'connected';
  customerUserId: string;
};

export type LocalCustomerRow = Customer & {
  source?: 'local';
};

export type ListedCustomer = LocalCustomerRow | ConnectedCustomerRow;

function normalizeCustomerKey(value: string) {
  return value.trim().toLowerCase();
}

export function mapConnectedCustomers(
  connections: Array<{
    customer_user_id: string;
    nickname?: string | null;
    created_at?: string | null;
    status?: string | null;
  }>,
): ConnectedCustomerRow[] {
  return connections.map((row) => ({
    id: `connected:${row.customer_user_id}`,
    name: resolveCustomerLabel({
      displayName: null,
      name: null,
      nickname: row.nickname,
      customerUserId: row.customer_user_id,
    }),
    phone: '',
    tier: 'C',
    dailyLimitUSDT: 0,
    notes: '',
    createdAt: row.created_at ? Date.parse(row.created_at) || Date.now() : Date.now(),
    source: 'connected',
    customerUserId: row.customer_user_id,
  }));
}

export function mergeListedCustomers(local: LocalCustomerRow[], connected: ConnectedCustomerRow[]) {
  const merged: ListedCustomer[] = [...connected, ...local.map((customer) => ({ ...customer, source: 'local' as const }))];
  const deduped: ListedCustomer[] = [];
  const seen = new Set<string>();

  for (const customer of merged) {
    const key = normalizeCustomerKey(customer.name) || normalizeCustomerKey(customer.id);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(customer);
  }

  return deduped;
}
