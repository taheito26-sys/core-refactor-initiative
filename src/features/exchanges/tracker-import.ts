import { fmtP } from '@/lib/tracker-helpers';
import { EXCHANGE_LABELS, type ExchangeId } from './types';

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

/**
 * Builds the note stored on the imported batch/trade so the full exchange
 * record — counterparty, order number, fiat amount, and exact date/time —
 * stays readable from the order/stock page without going back to the
 * exchange inbox. Kept in one place so both OrdersPage and StockPage produce
 * the same shape, and extractImportedReference above keeps matching it.
 */
export function buildImportNote(params: {
  exchange: ExchangeId;
  orderNumber: string;
  ts: number;
  assigneeName?: string;
  /** 'sold' for an outgoing trade note, 'bought' for an incoming batch note. */
  side: 'bought' | 'sold';
  /** Currency the current priceFiat/amountUSDT figures are quoted in (e.g. EGP or QAR). */
  quoteFiat: string;
  priceFiat: number;
  amountUSDT: number;
  needsQarRate?: boolean;
  originalFiat?: string;
  originalPriceFiat?: number;
  originalTotalFiat?: number;
}): string {
  const when = new Date(params.ts).toLocaleString();
  const who = params.assigneeName?.trim() || 'unknown counterparty';
  const head = `Imported from ${EXCHANGE_LABELS[params.exchange]} P2P order ${params.orderNumber} — counterparty ${who} — ${when}`;

  if (params.originalFiat) {
    return `${head} — ${params.side} for ${fmtP(params.originalPriceFiat ?? 0)} ${params.originalFiat}/USDT (${fmtP(params.originalTotalFiat ?? 0)} ${params.originalFiat} total)`;
  }
  const total = params.priceFiat * params.amountUSDT;
  return `${head} — ${params.side} ${fmtP(params.amountUSDT)} USDT for ${fmtP(total)} ${params.quoteFiat} (${fmtP(params.priceFiat)} ${params.quoteFiat}/USDT)`;
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
