import type { MonthBridge, MonthPosition } from '@/lib/trading/net-position';

// ─── Frozen month-end snapshots ───
//
// A month's position is rebuilt from dated records, so editing or deleting an
// old record would quietly change a month that was already closed. Closing a
// month saves the figures as they stood; later months start from the frozen
// closing, and anything that has changed since shows up as a visible
// correction instead of rewriting history.

export interface MonthlySnapshot {
  /** YYYY-MM. */
  month: string;
  frozen: boolean;
  closedAt: string;
  reopenedAt: string | null;
  reopenCount: number;
  position: MonthPosition;
  bridge: MonthBridge;
  rates: { usdToQar: number; egpPerUsdt: number; usdtRateQAR: number };
}

/** Differences under this many QAR are rounding, not a changed record. */
export const DRIFT_TOLERANCE_QAR = 1;

export function snapshotRates(month: MonthPosition): MonthlySnapshot['rates'] {
  const c = month.closing;
  return { usdToQar: c.usdToQar, egpPerUsdt: c.egpPerUsdt, usdtRateQAR: c.usdtRateQAR };
}

/** How far today's rebuild of a closed month has moved from what was frozen (positive: now higher). */
export function closingDrift(snapshot: Pick<MonthlySnapshot, 'position'>, live: MonthPosition): number {
  const diff = Math.round((live.closing.netQAR - snapshot.position.closing.netQAR) * 100) / 100;
  return Math.abs(diff) < DRIFT_TOLERANCE_QAR ? 0 : diff;
}

/** The month before `key` (YYYY-MM). */
export function previousMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Starts a month from the frozen closing of the month before it. The gap
 * between that and what today's records say the month opened with is shown as
 * "corrections to earlier months", so the bridge still adds up.
 */
export function chainToFrozenOpening(
  live: { opening: number; bridge: MonthBridge },
  prevFrozen: Pick<MonthlySnapshot, 'frozen' | 'position'> | undefined,
): { openingQAR: number; priorCorrectionsQAR: number; bridge: MonthBridge } {
  if (!prevFrozen?.frozen) {
    return { openingQAR: live.opening, priorCorrectionsQAR: 0, bridge: live.bridge };
  }
  const frozenClosing = prevFrozen.position.closing.netQAR;
  const raw = Math.round((live.opening - frozenClosing) * 100) / 100;
  const priorCorrectionsQAR = Math.abs(raw) < DRIFT_TOLERANCE_QAR ? 0 : raw;
  return {
    openingQAR: frozenClosing,
    priorCorrectionsQAR,
    bridge: { ...live.bridge, openingQAR: frozenClosing, priorCorrectionsQAR },
  };
}
