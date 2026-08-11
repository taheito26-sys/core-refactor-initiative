// Production-ready tracker state bootstrap — loads imported/local state first, then cloud
import { computeFIFO, type TrackerState, type DerivedState } from './tracker-helpers';
import { getCurrentTrackerState, hasMeaningfulTrackerData, isTrackerDataCleared } from './tracker-backup';

interface StateOverrides {
  lowStockThreshold?: number;
  priceAlertThreshold?: number;
  range?: string;
  currency?: 'QAR' | 'EGP' | 'USDT';
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Union deleted-loan tombstones from two sources, capped to a sane size. */
function unionDeletedLoanIds(a: string[] | undefined, b: string[] | undefined): string[] {
  return Array.from(new Set([...(a || []), ...(b || [])])).slice(-500);
}

/** Drop any loan whose id has been tombstoned — see TrackerState.deletedLoanIds. */
function withoutDeletedLoans(
  loans: import('./tracker-helpers').CustomerLoan[] | undefined,
  deletedLoanIds: string[] | undefined,
): import('./tracker-helpers').CustomerLoan[] {
  if (!Array.isArray(loans) || loans.length === 0) return [];
  const deleted = new Set(deletedLoanIds || []);
  return deleted.size === 0 ? loans : loans.filter(l => !deleted.has(l.id));
}

function stripCashState(stored: Partial<TrackerState> | null): Partial<TrackerState> | null {
  if (!stored) return stored;
  return {
    ...stored,
    cashQAR: 0,
    cashOwner: '',
    cashHistory: [],
    cashAccounts: [],
    cashLedger: [],
    customerLoans: [],
  };
}

function loadStoredTrackerState(): Partial<TrackerState> | null {
  if (typeof window === 'undefined') return null;

  const stored = getCurrentTrackerState(window.localStorage);
  if (!stored || typeof stored !== 'object') return null;

  const candidate = stored as Partial<TrackerState>;
  if (!hasMeaningfulTrackerData(candidate)) {
    return null;
  }

  return isTrackerDataCleared(window.localStorage) ? stripCashState(candidate) : candidate;
}

/** Build a TrackerState from a source (local or cloud), with overrides */
export function buildStateFrom(
  stored: Partial<TrackerState> | null,
  overrides?: StateOverrides,
): { state: TrackerState; derived: DerivedState } {
  const now = new Date();

  const state: TrackerState = {
    currency: overrides?.currency ?? (stored?.currency === 'USDT' ? 'USDT' : 'QAR'),
    range: overrides?.range ?? (typeof stored?.range === 'string' ? stored.range : '7d'),
    batches: Array.isArray(stored?.batches) ? stored.batches : [],
    trades: Array.isArray(stored?.trades) ? stored.trades : [],
    customers: Array.isArray(stored?.customers) ? stored.customers : [],
    suppliers: Array.isArray(stored?.suppliers) ? stored.suppliers : [],
    cashQAR: asNumber(stored?.cashQAR, 0),
    cashOwner: typeof stored?.cashOwner === 'string' ? stored.cashOwner : '',
    cashHistory: Array.isArray(stored?.cashHistory) ? stored.cashHistory : [],
    cashAccounts: Array.isArray(stored?.cashAccounts) ? stored.cashAccounts : [],
    cashLedger: Array.isArray(stored?.cashLedger) ? stored.cashLedger : [],
    customerLoans: withoutDeletedLoans(stored?.customerLoans, stored?.deletedLoanIds),
    deletedLoanIds: Array.isArray(stored?.deletedLoanIds) ? stored.deletedLoanIds : [],
    settings: {
      lowStockThreshold: overrides?.lowStockThreshold ?? asNumber(stored?.settings?.lowStockThreshold, 5000),
      priceAlertThreshold: overrides?.priceAlertThreshold ?? asNumber(stored?.settings?.priceAlertThreshold, 2),
    },
    cal: {
      year: asNumber(stored?.cal?.year, now.getFullYear()),
      month: asNumber(stored?.cal?.month, now.getMonth()),
      selectedDay: typeof stored?.cal?.selectedDay === 'number' ? stored.cal.selectedDay : null,
    },
  };

  const derived = computeFIFO(state.batches, state.trades);
  return { state, derived };
}

/**
 * Union local and cloud by id for every collection.
 * No row is ever dropped just because the other side has a higher total count.
 * Scalars (cashQAR, settings, cal, currency, range) prefer cloud when present,
 * otherwise fall back to local — cloud is authoritative for these.
 */
function unionById<T>(a: T[] | undefined, b: T[] | undefined): T[] {
  const out = new Map<string, T>();
  const push = (list: T[] | undefined) => {
    for (const item of list || []) {
      const key =
        typeof item === 'object' && item && 'id' in (item as Record<string, unknown>)
          ? String((item as Record<string, unknown>).id)
          : JSON.stringify(item);
      out.set(key, item);
    }
  };
  push(a);
  push(b);
  return Array.from(out.values());
}

export function mergeLocalAndCloud(
  local: Partial<TrackerState> | null,
  cloud: Partial<TrackerState> | null,
): Partial<TrackerState> | null {
  if (!cloud && !local) return null;
  if (!cloud) return local;
  if (!local) return cloud;

  if (isTrackerDataCleared()) {
    const cleanLocal = stripCashState(local) ?? {};
    const cleanCloud = stripCashState(cloud) ?? {};
    const deletedLoanIds = unionDeletedLoanIds(cleanLocal.deletedLoanIds, cleanCloud.deletedLoanIds);
    return {
      ...cleanLocal,
      ...cleanCloud,
      batches: unionById(cleanLocal.batches, cleanCloud.batches),
      trades: unionById(cleanLocal.trades, cleanCloud.trades),
      customers: unionById(cleanLocal.customers, cleanCloud.customers),
      suppliers: unionById(cleanLocal.suppliers, cleanCloud.suppliers),
      cashAccounts: [],
      cashLedger: [],
      cashHistory: [],
      cashQAR: 0,
      cashOwner: '',
      customerLoans: withoutDeletedLoans(unionById(cleanLocal.customerLoans, cleanCloud.customerLoans), deletedLoanIds),
      deletedLoanIds,
    };
  }

  const deletedLoanIds = unionDeletedLoanIds(local.deletedLoanIds, cloud.deletedLoanIds);
  return {
    ...local,
    ...cloud,
    batches: unionById(local.batches, cloud.batches),
    trades: unionById(local.trades, cloud.trades),
    customers: unionById(local.customers, cloud.customers),
    suppliers: unionById(local.suppliers, cloud.suppliers),
    cashAccounts: unionById(local.cashAccounts, cloud.cashAccounts),
    cashLedger: unionById(local.cashLedger, cloud.cashLedger),
    cashHistory: unionById(local.cashHistory, cloud.cashHistory),
    customerLoans: withoutDeletedLoans(unionById(local.customerLoans, cloud.customerLoans), deletedLoanIds),
    deletedLoanIds,
  };
}

export function createEmptyState(overrides?: StateOverrides): { state: TrackerState; derived: DerivedState } {
  const stored = loadStoredTrackerState();
  return buildStateFrom(stored, overrides);
}
