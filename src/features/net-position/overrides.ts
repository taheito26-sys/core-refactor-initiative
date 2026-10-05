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
  'cash_hand', 'cash_bank', 'cash_vault', 'cash_custody', 'usdt_in_accounts',
  'customer_loans', 'personal_loans', 'merchant_borrowed', 'manual_other',
];

/** Liabilities are typed as a positive amount owed. */
const isLiabilityLine = (key: NetPositionLineKey) => key === 'merchant_borrowed';

/** What the records say a line was at the start of the month, in the entered form. */
export function recordedLineValue(opening: Pick<NetPosition, 'lines'>, key: NetPositionLineKey): number {
  const line = opening.lines.find(l => l.key === key);
  if (!line) return 0;
  const signed = line.side === 'asset' ? line.amountQAR : -line.amountQAR;
  return isLiabilityLine(key) ? -signed : signed;
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
    const sign = isLiabilityLine(key) ? -1 : 1;
    const diff = Math.round(sign * (entered - recordedLineValue(recordedOpening, key)) * 100) / 100;
    if (diff) offsets[key] = diff;
  }
  return offsets;
}

/** Net position of an entered opening: assets minus what is owed. */
export function manualOpeningTotal(manual: Partial<Record<NetPositionLineKey, number>>): number {
  let total = 0;
  for (const key of MANUAL_LINE_KEYS) {
    const v = manual[key] ?? 0;
    total += isLiabilityLine(key) ? -v : v;
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
