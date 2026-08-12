import { useMemo } from 'react';
import { useT } from '@/lib/i18n';
import { useP2PMarketData } from '@/features/p2p/hooks/useP2PMarketData';
import type { P2POffer } from '@/features/p2p/types';

// Banque Misr only — bank name in English/Arabic as it appears in P2P payment method tags.
const BANQUE_MISR_RE = /banque\s*misr|bank\s*misr|بنك\s*مصر/i;

// Fixed QA sell avg per user request (overrides live Qatar market rate).
const QA_SELL_AVG_FIXED = 3.79;

export function BanqueMisrInstaPayKPI() {
  const t = useT();
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
    <div className="panel">
      <div className="panel-head">
        <h2>INSTAPAY V1 — Banque Misr</h2>
      </div>
      <div className="panel-body" style={{ padding: '6px 8px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '18px 0', color: 'var(--muted)', fontSize: 11 }}>
            {t('loading') || '...'}
          </div>
        ) : !kpi || kpi.instaPayV1BanqueMisr === null ? (
          <div style={{ textAlign: 'center', padding: '18px 0', color: 'var(--muted)', fontSize: 11 }}>
            {t('noDataAvailable')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>EGP per QAR</span>
              <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>
                {kpi.instaPayV1BanqueMisr.toFixed(4)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', paddingTop: 6, borderTop: '1px solid var(--line)' }}>
              <span>Top {kpi.offerCount} sell avg</span>
              <span className="mono">{kpi.egSellBanqueMisrAvg.toFixed(3)} EGP</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
              <span>QA sell avg</span>
              <span className="mono">{kpi.qaSellAvg?.toFixed(3)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
