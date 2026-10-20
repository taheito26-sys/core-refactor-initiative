import { useMemo } from 'react';
import { useP2PMarketData } from '@/features/p2p/hooks/useP2PMarketData';
import type { P2POffer } from '@/features/p2p/types';

// Banque Misr only — bank name in English/Arabic as it appears in P2P payment method tags.
const BANQUE_MISR_RE = /banque\s*misr|bank\s*misr|بنك\s*مصر/i;

// Fixed QA sell avg per user request (overrides live Qatar market rate).
const QA_SELL_AVG_FIXED = 3.79;

/** The QAR/EGP rate through Banque Misr InstaPay, from the cheapest five Egyptian sell offers. */
export function useBanqueMisrRate() {
  const { snapshot, loading } = useP2PMarketData('egypt');

  const kpi = useMemo(() => {
    if (!snapshot) return null;

    // Prefer the dedicated Banque Misr book the scraper fetches with a payTypes-filtered query.
    // Snapshots written before that change lack the field, so fall back to filtering the general
    // sell book by method name.
    const dedicated = snapshot.banqueMisrSellOffers || [];
    const matching = dedicated.length > 0
      ? dedicated
      : (snapshot.sellOffers || []).filter(
          (o: P2POffer) => o.methods.some(m => BANQUE_MISR_RE.test(m)),
        );

    const top5 = matching.slice().sort((a, b) => a.price - b.price).slice(0, 5);
    if (top5.length === 0) return null;

    const egSellBanqueMisrAvg = top5.reduce((s, o) => s + o.price, 0) / top5.length;
    const instaPayV1BanqueMisr = egSellBanqueMisrAvg / QA_SELL_AVG_FIXED;

    return { instaPayV1BanqueMisr, egSellBanqueMisrAvg, qaSellAvg: QA_SELL_AVG_FIXED, offerCount: top5.length };
  }, [snapshot]);

  return { kpi, loading };
}
