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

    const deduped = new Map<string, P2POffer>();
    (snapshot.sellOffers || []).forEach(o => {
      if (o.methods.some(m => BANQUE_MISR_RE.test(m)) && !deduped.has(o.nick)) {
        deduped.set(o.nick, o);
      }
    });

    const top6 = Array.from(deduped.values()).sort((a, b) => a.price - b.price).slice(0, 6);
    if (top6.length === 0) return null;

    const egSellBanqueMisrAvg = top6.reduce((s, o) => s + o.price, 0) / top6.length;
    const qaSellAvg = QA_SELL_AVG_FIXED;
    const instaPayV1BanqueMisr = egSellBanqueMisrAvg / qaSellAvg;

    return { instaPayV1BanqueMisr, egSellBanqueMisrAvg, qaSellAvg, offerCount: top6.length };
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
