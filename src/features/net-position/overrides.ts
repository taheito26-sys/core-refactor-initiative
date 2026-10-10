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

/**
 * The first month the page tracks. Earlier months are ignored, and this month
 * opens at exactly what the merchant types (zero for every line until then),
 * never at what older records add up to.
 */
export const NET_POSITION_START = '2026-10';

/** Lines the merchant can state, in the order the form shows them. */
export const MANUAL_LINE_KEYS: NetPositionLineKey[] = [
  'cash_hand', 'cash_bank', 'exchange_usdt', 'customer_loans', 'personal_loans',
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

const monthStartMs = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).getTime();

export interface LiveOffsets {
  /** Moves the closing (and, in later months, the opening too). */
  offsets: LineOffsets;
  /** Moves the opening of the month the figures were typed for. */
  openingOffsets: LineOffsets;
  /** The month the figures were typed for. */
  from: string;
  /** The moment the figures are counted from: changes recorded after it are added or removed. */
  baseline: number;
}

/**
 * The offsets in force for `month`, worked out from what was typed rather
 * than from what was saved, so editing an earlier record cannot move the
 * typed figures.
 *
 * Typed figures are what the merchant has at the moment they are saved, and
 * only changes recorded after that moment are counted on top. Whatever was
 * recorded before saving (a deposit made while setting up, a loan already
 * entered) is already inside the typed figure and is never added again.
 * With nothing typed, the first month opens at zero from its first day.
 */
export function liveOffsetsFor(
  overrides: Map<string, OpeningOverride>,
  month: string,
  /** What the records say each line was at that moment. */
  recordedAt: (ts: number) => Pick<NetPosition, 'lines'>,
): LiveOffsets | null {
  if (month < NET_POSITION_START) return null;
  let best: OpeningOverride | null = null;
  for (const o of overrides.values()) {
    if (o.month <= month && o.month >= NET_POSITION_START && (!best || o.month > best.month)) best = o;
  }
  const anchor: OpeningOverride = best ?? {
    month: NET_POSITION_START, manual: Object.fromEntries(MANUAL_LINE_KEYS.map(k => [k, 0])), offsets: {}, updatedAt: '',
  };
  const firstMoment = monthStartMs(anchor.month) - 1;
  const saved = Date.parse(anchor.updatedAt);
  const baseline = Number.isFinite(saved) ? Math.max(saved, firstMoment) : firstMoment;

  const offsets = offsetsFromManual(recordedAt(baseline), anchor.manual);
  const openingOffsets = anchor.month === month ? offsetsFromManual(recordedAt(firstMoment), anchor.manual) : { ...offsets };
  // USDT on the exchanges is typed for the month it was set for only; later months open from the frozen closing.
  if (anchor.month !== month) { delete openingOffsets.exchange_usdt; delete offsets.exchange_usdt; }
  const hasAny = Object.keys(offsets).length > 0 || Object.keys(openingOffsets).length > 0;
  return hasAny ? { offsets, openingOffsets, from: anchor.month, baseline } : null;
}
