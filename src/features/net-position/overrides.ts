import type { LineOffsets, NetPosition, NetPositionLineKey } from '@/lib/trading/net-position';

// ─── Opening positions entered by hand ───
//
// The records may not reach back far enough (the app was started mid-way) or
// may simply be wrong. A merchant can state what each line really was at the
// start of a month; the difference from the records becomes an offset that is
// applied to that month and every later month, until a later month is set
// again.

export interface OpeningOverride {
  /** YYYY-MM the starting position was set for. */
  month: string;
  /** What the merchant entered per line, in QAR, with a liability entered as a positive amount owed. */
  manual: Partial<Record<NetPositionLineKey, number>>;
  /** manual minus what the records said, per line, signed (asset positive, liability negative). */
  offsets: LineOffsets;
  updatedAt: string;
}

/** Lines the merchant can state, in the order the form shows them. */
export const MANUAL_LINE_KEYS: NetPositionLineKey[] = [
  'cash_hand', 'exchange_usdt', 'customer_loans', 'personal_loans',
];

/** What the records say a line was at the start of the month. */
export function recordedLineValue(opening: Pick<NetPosition, 'lines'>, key: NetPositionLineKey): number {
  const line = opening.lines.find(l => l.key === key);
  if (!line) return 0;
  const signed = line.side === 'asset' ? line.amountQAR : -line.amountQAR;
  return signed;
}

/** The signed offsets that turn the recorded opening into the entered one. */
export function offsetsFromManual(
  recordedOpening: Pick<NetPosition, 'lines'>,
  manual: Partial<Record<NetPositionLineKey, number>>,
): LineOffsets {
  const offsets: LineOffsets = {};
  for (const key of MANUAL_LINE_KEYS) {
    const entered = manual[key];
    if (entered === undefined || !Number.isFinite(entered)) continue;
    const diff = Math.round((entered - recordedLineValue(recordedOpening, key)) * 100) / 100;
    if (diff) offsets[key] = diff;
  }
  return offsets;
}

/** Net position of an entered opening: assets minus what is owed. */
export function manualOpeningTotal(manual: Partial<Record<NetPositionLineKey, number>>): number {
  let total = 0;
  for (const key of MANUAL_LINE_KEYS) {
    const v = manual[key] ?? 0;
    total += v;
  }
  return Math.round(total * 100) / 100;
}

/** The offsets in force for `month`: those of the latest override set for that month or any month before it. */
export function offsetsFor(overrides: Map<string, OpeningOverride>, month: string): { offsets: LineOffsets; from: string } | null {
  let best: OpeningOverride | null = null;
  for (const o of overrides.values()) {
    if (o.month <= month && (!best || o.month > best.month)) best = o;
  }
  return best && Object.keys(best.offsets).length > 0 ? { offsets: best.offsets, from: best.month } : null;
}

/**
 * The offsets in force for `month`, worked out from what was typed rather
 * than from what was saved. A saved offset is only right for the records as
 * they stood the day it was saved; if an earlier month is edited afterwards,
 * the records' opening moves and a fixed offset would leave the typed figures
 * wrong. Recomputing against today's records keeps the opening of the month
 * that was set by hand exactly as typed, whatever happens before it.
 */
export function liveOffsetsFor(
  overrides: Map<string, OpeningOverride>,
  month: string,
  recordedOpeningOf: (anchorMonth: string) => Pick<NetPosition, 'lines'>,
): { offsets: LineOffsets; from: string } | null {
  let best: OpeningOverride | null = null;
  for (const o of overrides.values()) {
    if (o.month <= month && (!best || o.month > best.month)) best = o;
  }
  if (!best) return null;
  const offsets = offsetsFromManual(recordedOpeningOf(best.month), best.manual);
  return Object.keys(offsets).length > 0 ? { offsets, from: best.month } : null;
}
