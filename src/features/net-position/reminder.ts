import type { TrackerState } from '@/lib/tracker-helpers';
import { monthKey } from '@/lib/trading/net-position';
import { previousMonthKey, type MonthlySnapshot } from './snapshots';

/**
 * The month to nudge the merchant to close: last month, when it had any
 * activity and has not been frozen. Null otherwise (nothing to close, or
 * already closed).
 */
export function monthToClose(
  state: Pick<TrackerState, 'batches' | 'trades' | 'cashLedger'>,
  snapshots: Map<string, MonthlySnapshot>,
  now = Date.now(),
): string | null {
  const key = previousMonthKey(monthKey(now));
  if (snapshots.get(key)?.frozen) return null;
  const inMonth = (ts: number) => monthKey(ts) === key;
  const active = (state.batches || []).some(b => inMonth(b.ts))
    || (state.trades || []).some(t => inMonth(t.ts))
    || (state.cashLedger || []).some(e => inMonth(e.ts));
  return active ? key : null;
}
