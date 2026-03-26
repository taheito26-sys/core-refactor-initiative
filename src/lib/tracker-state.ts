// Production-ready tracker state bootstrap — loads imported/local state first, then cloud
import { computeFIFO, type TrackerState, type DerivedState } from './tracker-helpers';
import { getCurrentTrackerState } from './tracker-backup';

interface StateOverrides {
  lowStockThreshold?: number;
  priceAlertThreshold?: number;
  range?: string;
  currency?: 'QAR' | 'USDT';
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function loadStoredTrackerState(): Partial<TrackerState> | null {
  if (typeof window === 'undefined') return null;

  const stored = getCurrentTrackerState(window.localStorage);
  if (!stored || typeof stored !== 'object') return null;

  const candidate = stored as Partial<TrackerState>;
  if (!Array.isArray(candidate.batches) && !Array.isArray(candidate.trades) && !Array.isArray(candidate.customers)) {
    return null;
  }

  return candidate;
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
    cashQAR: asNumber(stored?.cashQAR, 0),
    cashOwner: typeof stored?.cashOwner === 'string' ? stored.cashOwner : '',
    cashHistory: Array.isArray(stored?.cashHistory) ? stored.cashHistory : [],
    cashAccounts: Array.isArray(stored?.cashAccounts) ? stored.cashAccounts : [],
    cashLedger: Array.isArray(stored?.cashLedger) ? stored.cashLedger : [],
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

/** Pick the richer source between local and cloud state */
export function mergeLocalAndCloud(
  local: Partial<TrackerState> | null,
  cloud: Partial<TrackerState> | null,
): Partial<TrackerState> | null {
  if (!cloud && !local) return null;
  if (!cloud) return local;
  if (!local) return cloud;

  const localCount = (local.trades?.length ?? 0) + (local.batches?.length ?? 0) + (local.customers?.length ?? 0);
  const cloudCount = (cloud.trades?.length ?? 0) + (cloud.batches?.length ?? 0) + (cloud.customers?.length ?? 0);

  // Use whichever has more data
  return cloudCount >= localCount ? cloud : local;
}

export function createEmptyState(overrides?: StateOverrides): { state: TrackerState; derived: DerivedState } {
  const stored = loadStoredTrackerState();
  return buildStateFrom(stored, overrides);
}
