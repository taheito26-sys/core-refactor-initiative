import { useMemo } from 'react';
import { MerchantStat } from '../types';
import { fmtTotal } from '@/lib/tracker-helpers';

interface Props {
  merchantStats: MerchantStat[];
}

export function MerchantDepthStats({ merchantStats }: Props) {
  const topAlwaysAvailable = useMemo(
    () => [...merchantStats].sort((a, b) => b.appearances - a.appearances).slice(0, 5),
    [merchantStats]
  );
  const topQuantity = useMemo(
    () => [...merchantStats].sort((a, b) => b.maxAvailable - a.maxAvailable).slice(0, 5),
    [merchantStats]
  );

  return (
    <div className="tracker-root panel h-full flex flex-col overflow-hidden">
      <div className="panel-head shrink-0" style={{ padding: '6px 10px' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>Merchant Depth (24h)</h2>
        <span className="pill" style={{ fontSize: 8 }}>{merchantStats.length} tracked</span>
      </div>
      <div className="panel-body flex-1 min-h-0" style={{ padding: '8px 10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div className="text-[8px] font-extrabold tracking-[0.1em] uppercase muted mb-1.5">Top 5 Availability</div>
          <div className="space-y-1">
            {topAlwaysAvailable.map((stat, idx) => (
              <div key={`always-${stat.nick}`} className="flex items-center justify-between gap-2 text-[9px]">
                <span className="truncate"><span className="font-extrabold mr-1">{idx + 1}.</span>{stat.nick}</span>
                <span className="font-mono text-muted-foreground">{Math.round(stat.availabilityRatio * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[8px] font-extrabold tracking-[0.1em] uppercase muted mb-1.5">Top 5 USDT Qty</div>
          <div className="space-y-1">
            {topQuantity.map((stat, idx) => (
              <div key={`qty-${stat.nick}`} className="flex items-center justify-between gap-2 text-[9px]">
                <span className="truncate"><span className="font-extrabold mr-1">{idx + 1}.</span>{stat.nick}</span>
                <span className="font-mono text-muted-foreground">{fmtTotal(stat.maxAvailable)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}