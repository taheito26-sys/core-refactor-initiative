import { useMemo } from 'react';
import { MerchantStat } from '../types';
import { fmtTotal } from '@/lib/tracker-helpers';

interface Props {
  merchantStats: MerchantStat[];
  t: any;
}

export function MerchantDepthStats({ merchantStats, t }: Props) {
  const topAlwaysAvailable = useMemo(
    () => [...merchantStats].sort((a, b) => b.appearances - a.appearances).slice(0, 5),
    [merchantStats]
  );
  const topQuantity = useMemo(
    () => [...merchantStats].sort((a, b) => b.maxAvailable - a.maxAvailable).slice(0, 5),
    [merchantStats]
  );

  if (merchantStats.length === 0) {
    return (
      <div className="tracker-root panel">
        <div className="panel-head" style={{ padding: '8px 12px' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>{t('p2pMerchantDepthStats')}</h2>
        </div>
        <div className="panel-body flex items-center justify-center py-10 text-muted-foreground text-xs italic">
          {t('p2pNoData')}
        </div>
      </div>
    );
  }

  return (
    <div className="tracker-root panel">
      <div className="panel-head" style={{ padding: '8px 12px' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>{t('p2pMerchantDepthStats')}</h2>
        <span className="pill" style={{ fontSize: 9 }}>{merchantStats.length} {t('p2pTracked')}</span>
      </div>
      <div className="panel-body" style={{ padding: '8px 12px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div className="text-[9px] font-extrabold tracking-[0.14em] uppercase muted mb-2">{t('p2pTop5Available')}</div>
          <div className="space-y-1.5">
            {topAlwaysAvailable.map((stat, idx) => (
              <div key={`always-${stat.nick}`} className="flex items-center justify-between gap-2 text-[10px]">
                <span className="truncate"><span className="font-extrabold mr-1">{idx + 1}.</span>{stat.nick}</span>
                <span className="font-mono text-muted-foreground">{Math.round(stat.availabilityRatio * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[9px] font-extrabold tracking-[0.14em] uppercase muted mb-2">{t('p2pTop5Qty')}</div>
          <div className="space-y-1.5">
            {topQuantity.map((stat, idx) => (
              <div key={`qty-${stat.nick}`} className="flex items-center justify-between gap-2 text-[10px]">
                <span className="truncate"><span className="font-extrabold mr-1">{idx + 1}.</span>{stat.nick}</span>
                <div className="flex flex-col items-end">
                  <span className="font-mono text-foreground">{fmtTotal(stat.maxAvailable)}</span>
                  <span className="text-[8px] muted uppercase" style={{ fontSize: 7 }}>Avg {fmtTotal(stat.avgAvailable)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}