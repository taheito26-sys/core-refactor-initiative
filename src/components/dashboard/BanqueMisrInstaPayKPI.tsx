import { useMemo } from 'react';
import { useP2PMarketData } from '@/features/p2p/hooks/useP2PMarketData';
import type { P2POffer } from '@/features/p2p/types';

// Banque Misr only — bank name in English/Arabic as it appears in P2P payment method tags.
const BANQUE_MISR_RE = /banque\s*misr|bank\s*misr|بنك\s*مصر/i;

// Fixed QA sell avg per user request (overrides live Qatar market rate).
const QA_SELL_AVG_FIXED = 3.79;

export function BanqueMisrInstaPayKPI() {
  const { snapshot, loading } = useP2PMarketData('egypt');

  const kpi = useMemo(() => {
    if (!snapshot) return null;

    // Every Banque Misr sell offer counts, including repeat merchants — deduping
    // by nick was shrinking the pool below the intended top 5.
    const matching = (snapshot.sellOffers || []).filter(
      (o: P2POffer) => o.methods.some(m => BANQUE_MISR_RE.test(m)),
    );

    const top5 = matching.slice().sort((a, b) => a.price - b.price).slice(0, 5);
    if (top5.length === 0) return null;

    const egSellBanqueMisrAvg = top5.reduce((s, o) => s + o.price, 0) / top5.length;
    const qaSellAvg = QA_SELL_AVG_FIXED;
    const instaPayV1BanqueMisr = egSellBanqueMisrAvg / qaSellAvg;

    return { instaPayV1BanqueMisr, egSellBanqueMisrAvg, qaSellAvg, offerCount: top5.length };
  }, [snapshot]);

  return (
    <div className="kpi-card">
      <div className="kpi-lbl">QAR//EGP</div>
      <div className="kpi-val">
        {loading ? '…' : kpi ? kpi.instaPayV1BanqueMisr.toFixed(4) : '—'}
      </div>
      <div className="kpi-sub">
        {kpi ? `Banque Misr · top ${kpi.offerCount} sell avg ${kpi.egSellBanqueMisrAvg.toFixed(3)} EGP` : 'No data available'}
      </div>
    </div>
  );
}
