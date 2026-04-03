/**
 * Centralized WACOP (Weighted Average Cost of Purchase) hook.
 *
 * Single source of truth for USDT/QAR conversion across the app.
 * Computes the rate from current FIFO stock batches and persists
 * a daily snapshot to `daily_reference_rates` for audit/history.
 */
import { useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useTrackerState } from '@/lib/useTrackerState';
import { getWACOP, fmtQWithUnit, fmtPrice, fmtTotal, num, type DerivedState } from '@/lib/tracker-helpers';
import { useTheme } from '@/lib/theme-context';

/** Return value of the hook — everything a consumer needs */
export interface GlobalWACOP {
  /** Current WACOP (QAR per 1 USDT), or null if no stock */
  wacop: number | null;
  /** Active currency from settings ('QAR' | 'USDT') */
  currency: 'QAR' | 'USDT';
  /** Format a QAR amount according to the active currency + WACOP */
  fmt: (qarAmount: number) => string;
  /** Format a raw number as price with the active currency suffix */
  fmtWithSuffix: (qarAmount: number) => string;
  /** Convert QAR → USDT using WACOP (returns QAR if WACOP unavailable) */
  toActive: (qarAmount: number) => number;
  /** Whether WACOP data is available */
  hasRate: boolean;
}

export function useGlobalWACOP(): GlobalWACOP {
  const { userId } = useAuth();
  const { derived } = useTrackerState();
  const { settings } = useTheme();
  const savedDateRef = useRef<string | null>(null);

  const wacop = useMemo(() => (derived ? getWACOP(derived) : null), [derived]);
  const currency = settings.currency;

  // ── Persist daily snapshot ──
  useEffect(() => {
    if (!userId || !wacop || wacop <= 0 || !derived) return;

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (savedDateRef.current === today) return; // already saved today

    const activeBatches = derived.batches.filter(b => b.remainingUSDT > 0);
    const totalUsdt = activeBatches.reduce((s, b) => s + b.remainingUSDT, 0);
    const totalCostQar = activeBatches.reduce((s, b) => s + b.remainingUSDT * b.buyPriceQAR, 0);

    (async () => {
      try {
        const { error } = await supabase.from('daily_reference_rates' as any).upsert(
          {
            rate_date: today,
            wacop_rate: wacop,
            total_usdt_stock: totalUsdt,
            total_cost_basis_qar: totalCostQar,
            source: 'fifo_wacop',
            recorded_by: userId,
          },
          { onConflict: 'rate_date,recorded_by' }
        );
        if (!error) savedDateRef.current = today;
      } catch {
        // Silent fail — snapshot is convenience, not critical
      }
    })();
  }, [userId, wacop, derived]);

  const fmt = useCallback(
    (qarAmount: number) => fmtQWithUnit(qarAmount, currency, wacop),
    [currency, wacop]
  );

  const fmtWithSuffix = useCallback(
    (qarAmount: number) => {
      const q = num(qarAmount);
      if (!Number.isFinite(q)) return '—';
      if (currency === 'USDT' && wacop && wacop > 0) {
        return fmtPrice(q / wacop) + ' USDT';
      }
      return fmtTotal(q) + ' QAR';
    },
    [currency, wacop]
  );

  const toActive = useCallback(
    (qarAmount: number) => {
      if (currency === 'USDT' && wacop && wacop > 0) return qarAmount / wacop;
      return qarAmount;
    },
    [currency, wacop]
  );

  return {
    wacop,
    currency,
    fmt,
    fmtWithSuffix,
    toActive,
    hasRate: wacop !== null && wacop > 0,
  };
}
