import type { ExchangeId } from './types';

const STORAGE_KEY = 'exchangeImportPrefill';

export interface TrackerImportPrefill {
  kind: 'batch' | 'trade';
  exchange: ExchangeId;
  orderId: string;
  orderNumber: string;
  /** Always 'QAR' -- the currency the tracker actually books the order in. */
  fiat: string;
  amountUSDT: number;
  /** QAR unit price. For a non-QAR exchange order this is the user-entered USDT->QAR rate. */
  priceFiat: number;
  ts: number;
  /** Set when the exchange order wasn't in QAR -- the original fiat/price/total to keep on record. */
  originalFiat?: string;
  originalPriceFiat?: number;
  originalTotalFiat?: number;
}

export function stashTrackerImportPrefill(prefill: TrackerImportPrefill) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(prefill));
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
