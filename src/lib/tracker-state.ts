// Production-ready empty state factory — no demo data
import { computeFIFO, type TrackerState, type DerivedState } from './tracker-helpers';

interface StateOverrides {
  lowStockThreshold?: number;
  priceAlertThreshold?: number;
  range?: string;
  currency?: 'QAR' | 'USDT';
}

export function createEmptyState(overrides?: StateOverrides): { state: TrackerState; derived: DerivedState } {
  const state: TrackerState = {
    currency: overrides?.currency ?? 'QAR',
    range: overrides?.range ?? '7d',
    batches: [],
    trades: [],
    customers: [],
    cashQAR: 0,
    cashOwner: '',
    settings: {
      lowStockThreshold: overrides?.lowStockThreshold ?? 5000,
      priceAlertThreshold: overrides?.priceAlertThreshold ?? 2,
    },
    cal: { year: new Date().getFullYear(), month: new Date().getMonth(), selectedDay: null },
  };

  const derived = computeFIFO(state.batches, state.trades);
  return { state, derived };
}
