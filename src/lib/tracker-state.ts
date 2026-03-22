// Production-ready tracker state bootstrap — loads imported/local state first
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

export function createEmptyState(overrides?: StateOverrides): { state: TrackerState; derived: DerivedState } {
  const stored = loadStoredTrackerState();
  const now = new Date();

  const state: TrackerState = {
    currency: overrides?.currency ?? (stored?.currency === 'USDT' ? 'USDT' : 'QAR'),
    range: overrides?.range ?? (typeof stored?.range === 'string' ? stored.range : '7d'),
    batches: Array.isArray(stored?.batches) ? stored.batches : [],
    trades: Array.isArray(stored?.trades) ? stored.trades : [],
    customers: Array.isArray(stored?.customers) ? stored.customers : [],
    cashQAR: asNumber(stored?.cashQAR, 0),
    cashOwner: typeof stored?.cashOwner === 'string' ? stored.cashOwner : '',
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
