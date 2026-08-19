import type { ExchangeId } from './types';

const STORAGE_KEY = 'exchangeImportPrefill';

export interface TrackerImportPrefill {
  kind: 'batch' | 'trade';
  exchange: ExchangeId;
  orderId: string;
  orderNumber: string;
  fiat: string;
  amountUSDT: number;
  priceFiat: number;
  ts: number;
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
