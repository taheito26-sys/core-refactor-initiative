import { create } from 'zustand';
import type { FiatCurrency } from './currency';

export interface P2PPrices {
  egpToQar: number; // 1 EGP = X QAR
  qareToEgp: number; // 1 QAR = X EGP
  timestamp: number;
}

interface P2PRatesStore {
  rates: P2PPrices | null;
  lastValidRates: P2PPrices | null;
  setRates: (rates: P2PPrices) => void;
  isStale: () => boolean;
}

// 15 minute stale threshold
const STALE_THRESHOLD = 15 * 60 * 1000;

export const useP2PRatesStore = create<P2PRatesStore>((set, get) => ({
  rates: null,
  lastValidRates: null,
  setRates: (rates: P2PPrices) => {
    set({ rates, lastValidRates: rates });
  },
  isStale: () => {
    const state = get();
    if (!state.rates) return true;
    return Date.now() - state.rates.timestamp > STALE_THRESHOLD;
  },
}));

/**
 * Fetch latest P2P EGP/QAR rates from market data.
 * Calculates egpToQar (1 EGP = X QAR) and qareToEgp (1 QAR = X EGP) inverse.
 * Falls back to last known rate on error.
 */
export async function fetchP2PPrices(): Promise<P2PPrices> {
  const store = useP2PRatesStore.getState();

  try {
    // Fetch from Supabase P2P market data
    // The market data comes from the P2P scraper
    const response = await fetch('/api/p2p/rates', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    // data should contain: { egpToQar: number, timestamp: number }
    const egpToQar = parseFloat(data.egpToQar);
    if (!Number.isFinite(egpToQar) || egpToQar <= 0) {
      throw new Error('Invalid EGP/QAR rate');
    }

    const rates: P2PPrices = {
      egpToQar,
      qareToEgp: 1 / egpToQar,
      timestamp: Date.now(),
    };

    store.setRates(rates);
    return rates;
  } catch (error) {
    console.warn('[p2p-rates] Failed to fetch rates, using fallback', error);

    // Fall back to last known rate
    if (store.lastValidRates) {
      return store.lastValidRates;
    }

    // Ultimate fallback: 1 EGP ≈ 0.06 QAR (approximate historical rate)
    return {
      egpToQar: 0.06,
      qareToEgp: 16.67,
      timestamp: Date.now(),
    };
  }
}

/**
 * Get current rates (fetches if stale or missing)
 */
export async function getP2PRates(): Promise<P2PPrices> {
  const store = useP2PRatesStore.getState();

  if (store.rates && !store.isStale()) {
    return store.rates;
  }

  return fetchP2PPrices();
}

/**
 * Convert amount between currencies using P2P rates.
 * Handles QAR ↔ EGP and returns the same currency for any currency besides those two.
 */
export async function convertCurrency(
  amount: number,
  from: FiatCurrency,
  to: FiatCurrency,
  rates?: P2PPrices,
): Promise<number> {
  if (from === to || !Number.isFinite(amount)) {
    return amount;
  }

  // Get rates if not provided
  if (!rates) {
    rates = await getP2PRates();
  }

  // QAR ↔ EGP conversions
  if (from === 'QAR' && to === 'EGP') {
    return amount * rates.qareToEgp;
  }
  if (from === 'EGP' && to === 'QAR') {
    return amount * rates.egpToQar;
  }

  // USDT is the neutral intermediate currency
  // Other conversions: convert via USDT (requires WACOP context)
  // For now, return amount as-is for unsupported conversions
  return amount;
}

/**
 * Format a monetary amount in a target currency using P2P rates for conversion.
 * Falls back to displaying in original currency if conversion not supported.
 */
export async function formatWithConversion(
  amount: number,
  fromCurrency: FiatCurrency,
  toCurrency: FiatCurrency,
  formatFn: (n: number) => string,
): Promise<string> {
  if (fromCurrency === toCurrency) {
    return formatFn(amount);
  }

  try {
    const converted = await convertCurrency(amount, fromCurrency, toCurrency);
    return formatFn(converted);
  } catch (error) {
    console.warn('[p2p-rates] Conversion failed, displaying in original currency', error);
    return formatFn(amount);
  }
}
