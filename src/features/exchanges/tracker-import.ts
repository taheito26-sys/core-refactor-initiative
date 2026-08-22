import type { ExchangeId } from './types';

const STORAGE_KEY = 'exchangeImportPrefill';

export interface TrackerImportPrefill {
  kind: 'batch' | 'trade';
  exchange: ExchangeId;
  orderId: string;
  orderNumber: string;
  amountUSDT: number;
  ts: number;
  assigneeName?: string;
  /** QAR unit price, or 0 when the order was settled in another fiat. */
  priceFiat: number;
  /** True when the exchange order was not in QAR, so the form must ask for the rate. */
  needsQarRate?: boolean;
  /** Present for a non-QAR order -- the original figures, kept on the saved record. */
  originalFiat?: string;
  originalPriceFiat?: number;
  originalTotalFiat?: number;
}

export function stashTrackerImportPrefill(prefill: TrackerImportPrefill) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(prefill));
}

/**
 * Recovers the source order number / transfer reference embedded in a batch
 * or trade's note. Used as a fallback "already imported" signal for when the
 * batch/trade save succeeded but the follow-up call marking the exchange row
 * itself as linked failed (it's fire-and-forget) -- without this, that row
 * looks pending forever even though it's already in the tracker.
 */
export function extractImportedReference(note: string): string | null {
  const orderMatch = note.match(/P2P order (\S+)/);
  if (orderMatch) return orderMatch[1];
  const refMatch = note.match(/\(ref ([^)]+)\)/);
  if (refMatch) return refMatch[1];
  return null;
}

export function consumeTrackerImportPrefill(kind: 'batch' | 'trade'): TrackerImportPrefill | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TrackerImportPrefill;
    if (parsed.kind !== kind) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return parsed;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}
