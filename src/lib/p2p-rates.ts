import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import type { FiatCurrency } from './currency';

export interface P2PPrices {
  egpToQar: number; // 1 EGP = X QAR
  qarToEgp: number; // 1 QAR = X EGP
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

function snapshotMidRate(row: { data: unknown } | null): number | null {
  if (!row?.data) return null;
  const snap = row.data as Record<string, unknown>;
  const buyAvg = typeof snap.buyAvg === 'number' ? snap.buyAvg : null;
  const sellAvg = typeof snap.sellAvg === 'number' ? snap.sellAvg : null;
  if (buyAvg && sellAvg) return (buyAvg + sellAvg) / 2;
  return buyAvg ?? sellAvg ?? null;
}

/**
 * Fetch latest P2P EGP/QAR rates from market data.
 * Calculates egpToQar (1 EGP = X QAR) by combining Qatar (QAR/USDT) and
 * Egypt (EGP/USDT) snapshots: 1 EGP = QAR_rate / EGP_rate.
 * Falls back to last known rate on error.
 */
export async function fetchP2PPrices(): Promise<P2PPrices> {
  const store = useP2PRatesStore.getState();

  try {
    const [qatarResult, egyptResult] = await Promise.all([
      supabase
        .from('p2p_snapshots')
        .select('data, fetched_at')
        .eq('market', 'qatar')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('p2p_snapshots')
        .select('data, fetched_at')
        .eq('market', 'egypt')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (qatarResult.error) throw qatarResult.error;
    if (egyptResult.error) throw egyptResult.error;

    const qarPerUsdt = snapshotMidRate(qatarResult.data);
    const egpPerUsdt = snapshotMidRate(egyptResult.data);

    if (!qarPerUsdt || !egpPerUsdt || qarPerUsdt <= 0 || egpPerUsdt <= 0) {
      throw new Error('Invalid or missing P2P market rates');
    }

    // 1 USDT = qarPerUsdt QAR = egpPerUsdt EGP
    // So: 1 EGP = qarPerUsdt / egpPerUsdt QAR
    const egpToQar = qarPerUsdt / egpPerUsdt;

    if (!Number.isFinite(egpToQar) || egpToQar <= 0) {
      throw new Error('Invalid EGP/QAR rate');
    }

    const rates: P2PPrices = {
      egpToQar,
      qarToEgp: 1 / egpToQar,
      timestamp: Date.now(),
    };

    store.setRates(rates);
    return rates;
  } catch (error) {
    console.warn('[p2p-rates] Failed to fetch rates, using fallback', error);

    if (store.lastValidRates) {
      return store.lastValidRates;
    }

    // Ultimate fallback: 1 EGP ≈ 0.076 QAR (approximate historical rate)
    return {
      egpToQar: 0.076,
      qarToEgp: 13.16,
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
    return amount * rates.qarToEgp;
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
